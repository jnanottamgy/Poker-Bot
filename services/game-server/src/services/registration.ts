import type { TournamentPlayerStatus, TournamentPublicSummary, TournamentStatus } from '@jpb/shared-types';
import type { Store } from '../persistence/store';
import type { TournamentRecord } from '../persistence/repos/tournaments';
import type { PlayerRecord } from '../persistence/repos/players';
import { newId, newPublicPlayerId } from '../security/ids';
import { constantTimeEqual } from '../security/crypto';
import { displayNameOf, sanitizeRegistration } from './registration-fields';
import type { FieldError, RegistrationFields } from './registration-fields';
import { hashRejoinCode, newRejoinCode, normalizeRejoinCode, verifyRejoinCode } from './rejoin';

/** What registration needs from Johnny (implemented by the runtime integration). */
export interface RegistrationDirectorPort {
  registerPlayer(
    tournamentId: string,
    input: {
      playerId: string;
      entryId: string;
      displayName: string;
      publicId: string;
      registrationSeq: number;
      clientSeed: string | null;
      approved: boolean;
    },
  ): Promise<{ ok: boolean; code: string | null; message: string | null }>;
  /** Live counters/clock for the join page; null when the director is not running yet. */
  publicSummary(tournamentId: string): Promise<TournamentPublicSummary | null>;
}

export type RegistrationResult =
  | { ok: true; player: PlayerRecord; entryId: string; status: TournamentPlayerStatus; rejoinCode: string }
  | { ok: false; code: 'NOT_FOUND' | 'REGISTRATION_CLOSED' | 'ACCESS_CODE' | 'INVALID_FIELDS' | 'REJECTED'; message: string; errors?: FieldError[] };

const OPEN_STATES: readonly TournamentStatus[] = ['REGISTRATION'];
const LATE_STATES: readonly TournamentStatus[] = ['STARTING', 'RUNNING', 'BREAK', 'PAUSED'];

export function registrationOpen(t: TournamentRecord): boolean {
  if (OPEN_STATES.includes(t.status)) return t.config.registrationDeadline === null || Date.now() <= t.config.registrationDeadline;
  // Late registration: the director enforces the level limit; we only pre-filter by state.
  return t.config.lateRegistration.enabled && LATE_STATES.includes(t.status);
}

export class RegistrationService {
  constructor(
    private readonly store: Store,
    private readonly director: RegistrationDirectorPort,
  ) {}

  async joinInfo(joinCode: string) {
    const t = await this.store.repos.tournaments.getByJoinCode(joinCode);
    if (!t || t.isSimulation) return null;
    const summary = await this.director.publicSummary(t.id).catch(() => null);
    return {
      tournamentId: t.id,
      name: t.name,
      joinCode: t.joinCode,
      status: t.status,
      startTime: t.config.startTime,
      serverSeedHash: t.serverSeedHash,
      registration: {
        open: registrationOpen(t),
        fields: t.config.registration.fields,
        requiresAccessCode: t.config.registration.accessCode !== null,
        requiresApproval: t.config.registration.requireApproval,
        deadline: t.config.registrationDeadline,
        lateRegistration: t.config.lateRegistration,
      },
      limits: { minPlayers: t.config.minPlayers, maxPlayers: t.config.maxPlayers },
      startingStack: t.config.startingStack,
      counters: summary?.counters ?? null,
      spectators: { publicWatch: t.config.spectators.enabled && t.config.spectators.publicWatch },
      prizes: { currency: t.config.prizeStructure.currency, places: t.config.prizeStructure.places, notes: t.config.prizeStructure.notes ?? null },
    };
  }

  async register(
    joinCode: string,
    input: { fields: Record<string, unknown>; accessCode: string | null; clientSeed: string | null },
    opts: { byStaff?: { adminId: string } } = {},
  ): Promise<RegistrationResult> {
    const t = await this.store.repos.tournaments.getByJoinCode(joinCode);
    if (!t || t.isSimulation) return { ok: false, code: 'NOT_FOUND', message: 'Tournament not found.' };
    if (!registrationOpen(t)) return { ok: false, code: 'REGISTRATION_CLOSED', message: 'Registration is closed for this tournament.' };
    const required = t.config.registration.accessCode;
    if (required && !opts.byStaff && !constantTimeEqual((input.accessCode ?? '').trim().toUpperCase(), required.toUpperCase())) {
      return { ok: false, code: 'ACCESS_CODE', message: 'That access code is not correct. Ask the organizers.' };
    }
    const sanitized = sanitizeRegistration(t.config.registration, input.fields);
    if (!sanitized.ok) return { ok: false, code: 'INVALID_FIELDS', message: 'Please check the highlighted fields.', errors: sanitized.errors };
    const clientSeed = input.clientSeed && /^[0-9a-f]{32,128}$/.test(input.clientSeed) ? input.clientSeed : null;
    const approved = !t.config.registration.requireApproval || !!opts.byStaff;
    const rejoinCode = newRejoinCode();
    const rejoinHash = await hashRejoinCode(rejoinCode);

    const created = await this.store.transaction(async (repos) => {
      const publicId = await this.uniquePublicId(t, (id) => repos.players.publicIdExists(t.id, id));
      const player = await repos.players.createPlayer({
        id: newId('ply'),
        tournamentId: t.id,
        publicId,
        displayName: displayNameOf(sanitized.fields),
        nickname: sanitized.fields.nickname ?? null,
        participantId: sanitized.fields.participantId ?? null,
        email: sanitized.fields.email ?? null,
        phone: sanitized.fields.phone ?? null,
        collegeId: sanitized.fields.collegeId ?? null,
      });
      await repos.players.setRejoinCodeHash(player.id, rejoinHash);
      // Reserved last: the tournament row stays locked only for the final insert.
      const seq = await repos.tournaments.nextRegistrationSeq(t.id);
      const entry = await repos.players.createEntry({
        entryId: newId('ent'),
        tournamentId: t.id,
        playerId: player.id,
        registrationSeq: seq,
        entryNumber: 1,
        status: approved ? 'REGISTERED' : 'PENDING_APPROVAL',
        clientSeed,
        stack: 0,
      });
      if (opts.byStaff) await repos.players.updateEntryState(entry.entryId, { approvedAt: new Date(), approvedBy: opts.byStaff.adminId });
      return { player, entry, seq };
    });

    const reply = await this.director.registerPlayer(t.id, {
      playerId: created.player.id,
      entryId: created.entry.entryId,
      displayName: created.player.displayName,
      publicId: created.player.publicId,
      registrationSeq: created.seq,
      clientSeed,
      approved,
    });
    if (!reply.ok) {
      await this.store.repos.players.updateEntryState(created.entry.entryId, { status: 'WITHDRAWN' });
      return { ok: false, code: 'REJECTED', message: reply.message ?? 'Registration was not accepted.' };
    }
    return { ok: true, player: created.player, entryId: created.entry.entryId, status: created.entry.status, rejoinCode };
  }

  /** Verifies a rejoin code. Returns the player on success. */
  async rejoin(joinCode: string, publicId: string, code: string): Promise<PlayerRecord | null> {
    const t = await this.store.repos.tournaments.getByJoinCode(joinCode);
    const normalized = normalizeRejoinCode(code);
    if (!t || !normalized) return null;
    const player = await this.store.repos.players.getByPublicId(t.id, publicId.trim().toUpperCase());
    const hash = player ? await this.store.repos.players.getRejoinCodeHash(player.id) : null;
    // Always spend comparable time, even for unknown players.
    const ok = await verifyRejoinCode(normalized, hash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    return ok && player ? player : null;
  }

  /** Issues a fresh rejoin code (staff helps a player who switched phones). */
  async reissueRejoinCode(playerId: string): Promise<string> {
    const code = newRejoinCode();
    await this.store.repos.players.setRejoinCodeHash(playerId, await hashRejoinCode(code));
    return code;
  }

  private async uniquePublicId(t: TournamentRecord, exists: (id: string) => Promise<boolean>): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const id = newPublicPlayerId(t.config.maxPlayers);
      if (!(await exists(id))) return id;
    }
    throw new Error('Could not allocate a unique public player id');
  }
}

export type { RegistrationFields };
