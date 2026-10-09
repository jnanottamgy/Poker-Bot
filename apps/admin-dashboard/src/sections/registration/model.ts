import type { BlindLevel, RegistrationFieldKey, TableSizeConfig, TournamentConfig, TournamentStatus } from '@jpb/shared-types';
import type { IconName, Tone } from '@jpb/ui';
import { formatCount } from '@jpb/ui';

/**
 * Display model of §2.9 Registration. Nothing here decides anything: the
 * server applies every rule; these helpers only explain the configuration.
 */

export interface RegState {
  key: 'draft' | 'open' | 'closed' | 'late' | 'late-ended' | 'over';
  label: string;
  tone: Tone;
  icon: IconName;
  detail: string;
}

const LATE_STATES: ReadonlySet<TournamentStatus> = new Set(['STARTING', 'RUNNING', 'BREAK', 'PAUSED']);

/** Where registration stands (mirrors the server: REGISTRATION = open; late registration while running through `untilLevel`). */
export function registrationState(status: TournamentStatus | null, config: TournamentConfig | null, level: BlindLevel | null): RegState {
  const late = config?.lateRegistration;
  switch (status) {
    case null:
      return { key: 'closed', label: 'Unknown', tone: 'neutral', icon: 'dot', detail: 'Loading the tournament state…' };
    case 'DRAFT':
      return { key: 'draft', label: 'Not open yet', tone: 'neutral', icon: 'file', detail: 'Open registration to let players join with the link or QR code.' };
    case 'REGISTRATION':
      return { key: 'open', label: 'Registration open', tone: 'positive', icon: 'users', detail: 'Players can join with the link or QR code.' };
    case 'REGISTRATION_CLOSED':
      return { key: 'closed', label: 'Registration closed', tone: 'warning', icon: 'lock', detail: 'Nobody can join. Reopen it, or start the tournament.' };
    default:
      if (!LATE_STATES.has(status)) return { key: 'over', label: 'Registration over', tone: 'neutral', icon: 'lock', detail: 'The tournament is past the point where players can join.' };
      if (!late?.enabled) return { key: 'over', label: 'Registration over', tone: 'neutral', icon: 'lock', detail: 'Late registration is not enabled for this tournament.' };
      if (level && level.level > late.untilLevel) {
        return { key: 'late-ended', label: 'Late registration ended', tone: 'neutral', icon: 'lock', detail: `Late registration closed at the end of level ${late.untilLevel}.` };
      }
      return { key: 'late', label: 'Late registration open', tone: 'info', icon: 'clock', detail: `Players can still join until the end of level ${late.untilLevel}${level ? ` (now level ${level.level})` : ''}.` };
  }
}

// ---------------------------------------------------------------- seating preview

/** Above the final-table size play is spread over at least this many tables (seating-engine MIN_TABLES_BEFORE_FINAL). */
const MIN_TABLES_BEFORE_FINAL = 2;

/**
 * Number of tables for `players` (normative formula of @jpb/seating-engine
 * `computeTableCount`, README "Table count"):
 *   players <= finalTableSize → 1
 *   otherwise max(2, ceil(n / maxSize), min(ceil(n / d), floor(n / minSize)))
 *   with d = targetSize ('TARGET') or maxSize ('MAX').
 * Display only — the director seats players on the server.
 */
export function tableCount(players: number, cfg: TableSizeConfig, consolidateBy: 'TARGET' | 'MAX'): number {
  if (players <= 0) return 0;
  if (players <= cfg.finalTableSize) return 1;
  const d = consolidateBy === 'TARGET' ? cfg.targetSize : cfg.maxSize;
  const byMin = cfg.minSize > 0 ? Math.floor(players / cfg.minSize) : Number.POSITIVE_INFINITY;
  return Math.max(MIN_TABLES_BEFORE_FINAL, Math.ceil(players / cfg.maxSize), Math.min(Math.ceil(players / d), byMin));
}

export interface SeatingPreview {
  players: number;
  tables: number;
  /** e.g. [{ size: 9, count: 12 }, { size: 8, count: 3 }] (balanced: sizes differ by at most one). */
  groups: Array<{ size: number; count: number }>;
}

/** N players → T tables, with the balanced table sizes (`distributeSizes`: the first n mod T tables get one more). */
export function seatingPreview(players: number, cfg: TableSizeConfig, consolidateBy: 'TARGET' | 'MAX'): SeatingPreview {
  const tables = tableCount(players, cfg, consolidateBy);
  if (tables === 0) return { players, tables, groups: [] };
  const base = Math.floor(players / tables);
  const extra = players % tables;
  const groups = [
    { size: base + 1, count: extra },
    { size: base, count: tables - extra },
  ].filter((g) => g.count > 0);
  return { players, tables, groups };
}

export function seatingText(p: SeatingPreview): string {
  if (p.tables === 0) return 'No players to seat yet';
  const sizes = p.groups.map((g) => `${formatCount(g.count)} × ${g.size}`).join(' + ');
  return `${formatCount(p.players)} players → ${formatCount(p.tables)} table${p.tables === 1 ? '' : 's'} (${sizes} players)`;
}

// ---------------------------------------------------------------- registration fields

export const FIELD_LABEL: Readonly<Record<RegistrationFieldKey, string>> = {
  name: 'Name',
  nickname: 'Nickname',
  participantId: 'Participant ID',
  email: 'Email',
  phone: 'Phone',
  collegeId: 'College ID',
};

/** Length limits the server enforces (game-server registration-fields.ts); shown as maxLength hints. */
export const FIELD_MAX_LENGTH: Readonly<Record<RegistrationFieldKey, number>> = {
  name: 40,
  nickname: 24,
  participantId: 40,
  email: 254,
  phone: 20,
  collegeId: 40,
};

export const FIELD_INPUT: Readonly<Record<RegistrationFieldKey, { type: string; autoComplete: string; inputMode?: 'email' | 'tel' | 'text' }>> = {
  name: { type: 'text', autoComplete: 'off' },
  nickname: { type: 'text', autoComplete: 'off' },
  participantId: { type: 'text', autoComplete: 'off' },
  email: { type: 'email', autoComplete: 'off', inputMode: 'email' },
  phone: { type: 'tel', autoComplete: 'off', inputMode: 'tel' },
  collegeId: { type: 'text', autoComplete: 'off' },
};

/** Fields of the manual registration form: the configured ones, with `name` always first and required (server rule). */
export function formFields(config: TournamentConfig): Array<{ key: RegistrationFieldKey; label: string; required: boolean }> {
  const out = config.registration.fields.map((f) => ({ key: f.key, label: f.label ?? FIELD_LABEL[f.key], required: f.key === 'name' ? true : f.required }));
  if (!out.some((f) => f.key === 'name')) out.unshift({ key: 'name', label: FIELD_LABEL.name, required: true });
  return out.sort((a, b) => (a.key === 'name' ? -1 : b.key === 'name' ? 1 : 0));
}
