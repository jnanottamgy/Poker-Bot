import type {
  ActionType,
  CommandReply,
  PlayerId,
  PlayerSelfSummary,
  TableId,
  TournamentConfig,
  TournamentId,
  TournamentPublicSummary,
} from '@jpb/shared-types';
import { clientSeedProblem, computePublicEntropy, createSeedCommitment } from '@jpb/fairness-engine/node';
import type { AdminMeta, DirectorInput } from '@jpb/tournament-engine';
import type { Store } from '../persistence/store';
import type { TournamentRecord } from '../persistence/repos/tournaments';
import type { NodeRuntime } from '../runtime/node-runtime';
import type { ActorCatalog } from '../runtime/node-runtime';
import type { GatewayBackend, TableUpdateMessage } from '../runtime/contracts';
import { isActorError } from '../runtime/errors';
import type { RegistrationDirectorPort } from '../services/registration';
import { newId, newJoinCode } from '../security/ids';
import type { SeedService } from './seeds';
import type { AuditMeta, DirectorActorCommand, DirectorActorReply, DirectorQuery } from './director-actor';
import type { TableActorCommand, TableActorReply, TableQuery } from './table-actor';

const LIVE_STATUSES = ['REGISTRATION', 'REGISTRATION_CLOSED', 'STARTING', 'RUNNING', 'BREAK', 'PAUSED', 'FINAL_TABLE'] as const;
const ID_PATTERN = /^[A-Za-z0-9_:.-]{1,128}$/;

export interface GameServiceDeps {
  store: Store;
  node: NodeRuntime;
  seeds: SeedService;
  now?: () => number;
  /** Per-request deadline for actor commands (default 10 s). */
  timeoutMs?: number;
  /** How long tournament configs are cached for policy checks (default 3 s). */
  configTtlMs?: number;
}

export class GameError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

/**
 * The poker application on top of the generic actor runtime: tournament
 * creation (server seed commitment), director inputs and queries, table
 * queries and player actions. It implements the gateway backend and the
 * registration port, and supplies the actor catalog for placement.
 */
export class GameService implements GatewayBackend, RegistrationDirectorPort {
  private readonly now: () => number;
  private readonly configs = new Map<string, { at: number; record: TournamentRecord }>();
  private readonly playerTournament = new Map<string, string>();
  private readonly knownTables = new Map<string, string>();

  constructor(private readonly deps: GameServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  get store(): Store {
    return this.deps.store;
  }

  get node(): NodeRuntime {
    return this.deps.node;
  }

  // ------------------------------------------------------------------ tournaments

  /** Creates a DRAFT tournament: commits to a fresh server seed, stores it encrypted and initializes Johnny. */
  async createTournament(input: { config: TournamentConfig; createdBy: string | null; isSimulation?: boolean }): Promise<TournamentRecord> {
    const id = newId('trn');
    const { serverSeed, serverSeedHash } = createSeedCommitment();
    let joinCode = newJoinCode();
    for (let i = 0; i < 20 && (await this.deps.store.repos.tournaments.joinCodeExists(joinCode)); i++) joinCode = newJoinCode(i > 10 ? 8 : 6);
    const record = await this.deps.store.repos.tournaments.create({
      id,
      joinCode,
      config: input.config,
      serverSeedHash,
      serverSeedEnc: this.deps.seeds.encrypt(id, serverSeed),
      isSimulation: input.isSimulation ?? false,
      createdBy: input.createdBy,
    });
    this.deps.seeds.remember(id, serverSeed);
    const reply = await this.director(id, { kind: 'CREATE', input: { tournamentId: id, config: input.config, createdAt: this.now(), serverSeedHash } });
    if (!reply.ok) throw new GameError(reply.code ?? 'CREATE_FAILED', reply.message ?? 'Could not initialize the tournament director.');
    return record;
  }

  async tournament(tournamentId: string, maxAgeMs = this.deps.configTtlMs ?? 3000): Promise<TournamentRecord | null> {
    if (!ID_PATTERN.test(tournamentId)) return null;
    const hit = this.configs.get(tournamentId);
    if (hit && this.now() - hit.at <= maxAgeMs) return hit.record;
    const record = await this.deps.store.repos.tournaments.get(tournamentId);
    if (record) this.configs.set(tournamentId, { at: this.now(), record });
    else this.configs.delete(tournamentId);
    return record;
  }

  invalidateTournament(tournamentId: string): void {
    this.configs.delete(tournamentId);
  }

  /** Submits one director input; admin inputs carry audit metadata written in the same transaction. */
  async directorInput(tournamentId: string, input: DirectorInput, audit?: AuditMeta): Promise<DirectorActorReply> {
    await this.mustExist(tournamentId);
    const reply = await this.director(tournamentId, { kind: 'INPUT', input, ...(audit ? { audit } : {}) });
    this.invalidateTournament(tournamentId);
    return reply;
  }

  /** START: freezes the public entropy from the registered client seeds and the admin's entropy, then deals. */
  async start(tournamentId: string, admin: AdminMeta, adminEntropy: string | null, audit?: AuditMeta): Promise<DirectorActorReply & { publicEntropy: string }> {
    const seeds = (await this.deps.store.repos.players.listClientSeeds(tournamentId)).filter((s) => clientSeedProblem(s) === null);
    const publicEntropy = computePublicEntropy({ clientSeeds: seeds, adminEntropy: adminEntropy ?? null });
    const reply = await this.directorInput(tournamentId, { type: 'START', publicEntropy, admin }, audit);
    return { ...reply, publicEntropy };
  }

  async directorQuery<T>(tournamentId: string, query: DirectorQuery): Promise<T | null> {
    if (!(await this.exists(tournamentId))) return null;
    const reply = await this.director(tournamentId, { kind: 'QUERY', query });
    return (reply.data ?? null) as T | null;
  }

  async tableQuery<T>(tableId: string, query: TableQuery): Promise<T | null> {
    if (!(await this.tableExists(tableId))) return null;
    const reply = await this.deps.node.submit<TableActorReply>('table', tableId, { kind: 'QUERY', query } satisfies TableActorCommand, { timeoutMs: this.timeout() });
    return (reply.data ?? null) as T | null;
  }

  /** Tournament that owns a table (cached; tables never move between tournaments). */
  async tableTournament(tableId: string): Promise<string | null> {
    if (!ID_PATTERN.test(tableId)) return null;
    const hit = this.knownTables.get(tableId);
    if (hit) return hit;
    const row = await this.deps.store.repos.tableLogs.getTable(tableId);
    if (!row) return null;
    this.knownTables.set(tableId, row.tournamentId);
    return row.tournamentId;
  }

  async playerTournamentOf(playerId: string): Promise<string | null> {
    if (!ID_PATTERN.test(playerId)) return null;
    const hit = this.playerTournament.get(playerId);
    if (hit) return hit;
    const p = await this.deps.store.repos.players.getPlayer(playerId);
    if (!p) return null;
    this.playerTournament.set(playerId, p.tournamentId);
    return p.tournamentId;
  }

  // ------------------------------------------------------------------ gateway backend

  async tournamentSummary(tournamentId: TournamentId): Promise<TournamentPublicSummary | null> {
    return this.directorQuery<TournamentPublicSummary>(tournamentId, { q: 'SUMMARY' });
  }

  async playerSelf(playerId: PlayerId): Promise<PlayerSelfSummary | null> {
    const tid = await this.playerTournamentOf(playerId);
    if (!tid) return null;
    return this.directorQuery<PlayerSelfSummary>(tid, { q: 'PLAYER_SELF', playerId });
  }

  async tableSnapshot(tableId: TableId): Promise<TableUpdateMessage | null> {
    return this.tableQuery<TableUpdateMessage>(tableId, { q: 'UPDATE' });
  }

  async featuredTable(tournamentId: TournamentId): Promise<TableId | null> {
    return this.directorQuery<TableId>(tournamentId, { q: 'FEATURED' });
  }

  async canSpectate(tournamentId: TournamentId, playerId: PlayerId | null): Promise<boolean> {
    const t = await this.tournament(tournamentId);
    if (!t || !t.config.spectators.enabled) return false;
    if (t.config.spectators.publicWatch) return true;
    if (!playerId || !t.config.spectators.allowEliminatedPlayers) return false;
    const self = await this.playerSelf(playerId);
    return self !== null && (self.status === 'ELIMINATED' || self.status === 'DISQUALIFIED');
  }

  async canDisplay(tournamentId: TournamentId): Promise<boolean> {
    const t = await this.tournament(tournamentId);
    return !!t && t.config.features.broadcastDisplay;
  }

  async spectatorDelayMs(tournamentId: TournamentId): Promise<number> {
    const t = await this.tournament(tournamentId);
    return t ? Math.max(0, t.config.spectators.delaySeconds) * 1000 : 0;
  }

  async submitPlayerAction(input: {
    playerId: PlayerId;
    tableId: TableId;
    actionId: string;
    type: ActionType;
    amount?: number;
    tableStateVersion: number;
    receivedAt: number;
  }): Promise<CommandReply> {
    if (!(await this.tableExists(input.tableId))) return { ok: false, code: 'PLAYER_NOT_SEATED', message: 'That table does not exist.', duplicate: false };
    const command: TableActorCommand = {
      kind: 'PLAYER',
      command: {
        type: 'PLAYER_ACTION',
        actionId: input.actionId,
        playerId: input.playerId,
        intent: { type: input.type, ...(input.amount !== undefined ? { amount: input.amount } : {}) },
        tableStateVersion: input.tableStateVersion,
      },
    };
    try {
      const reply = await this.deps.node.submit<TableActorReply>('table', input.tableId, command, { timeoutMs: this.timeout() });
      return { ok: reply.ok, code: reply.code, message: reply.message, duplicate: reply.duplicate };
    } catch (err) {
      if (isActorError(err, 'CONFLICT')) return { ok: true, code: null, message: null, duplicate: true };
      throw err;
    }
  }

  playerConnection(playerId: PlayerId, connected: boolean): void {
    void (async () => {
      const self = await this.playerSelf(playerId);
      if (!self?.tableId) return;
      await this.deps.node.submit('table', self.tableId, { kind: 'CONNECTION', command: { type: 'PLAYER_CONNECTION', playerId, connected } } satisfies TableActorCommand, {
        timeoutMs: this.timeout(),
      });
    })().catch(() => undefined);
  }

  // ------------------------------------------------------------------ registration port

  async registerPlayer(
    tournamentId: string,
    input: { playerId: string; entryId: string; displayName: string; publicId: string; registrationSeq: number; clientSeed: string | null; approved: boolean },
  ): Promise<{ ok: boolean; code: string | null; message: string | null }> {
    this.playerTournament.set(input.playerId, tournamentId);
    const reply = await this.directorInput(tournamentId, { type: 'REGISTER_PLAYER', ...input });
    return { ok: reply.ok, code: reply.code, message: reply.message };
  }

  publicSummary(tournamentId: string): Promise<TournamentPublicSummary | null> {
    return this.tournamentSummary(tournamentId);
  }

  // ------------------------------------------------------------------ catalog

  /** Actors that must run somewhere: directors of live tournaments and their open tables. */
  catalog(): ActorCatalog {
    return {
      list: async (kind: string) => {
        const q = this.deps.store.repos.q;
        if (kind === 'director') {
          const r = await q.query<{ id: string }>(`SELECT id FROM tournaments WHERE status = ANY($1::text[])`, [LIVE_STATUSES]);
          return r.rows.map((x) => x.id);
        }
        if (kind === 'table') {
          const r = await q.query<{ id: string }>(
            `SELECT t.id FROM tables t JOIN tournaments x ON x.id = t.tournament_id
              WHERE t.closed_at IS NULL AND t.status <> 'CLOSED' AND x.status = ANY($1::text[])`,
            [LIVE_STATUSES],
          );
          return r.rows.map((x) => x.id);
        }
        return [];
      },
    };
  }

  // ------------------------------------------------------------------ internals

  private timeout(): number {
    return this.deps.timeoutMs ?? 10_000;
  }

  private director(tournamentId: string, command: DirectorActorCommand): Promise<DirectorActorReply> {
    return this.deps.node.submit<DirectorActorReply>('director', tournamentId, command, { timeoutMs: this.timeout() });
  }

  private async exists(tournamentId: string): Promise<boolean> {
    return (await this.tournament(tournamentId, Number.POSITIVE_INFINITY)) !== null;
  }

  private async mustExist(tournamentId: string): Promise<void> {
    if (!(await this.exists(tournamentId))) throw new GameError('NOT_FOUND', 'Tournament not found.', 404);
  }

  private async tableExists(tableId: string): Promise<boolean> {
    return (await this.tableTournament(tableId)) !== null;
  }
}
