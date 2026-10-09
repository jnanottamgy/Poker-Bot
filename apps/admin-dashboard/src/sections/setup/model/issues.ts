import type { TournamentConfig } from '@jpb/shared-types';
import { formatCount } from '@jpb/ui';
import { REGISTRATION_FIELD_LABELS, formatPath, humanizePath, validateTournamentConfig } from '@jpb/validation';
import type { PathSegment, ValidationIssue } from '@jpb/validation';
import { STEP_IDS, stepOfPath } from './steps';
import type { StepId } from './steps';

/**
 * Validation for the wizard: @jpb/validation's `validateTournamentConfig`
 * (the very function the server runs) turned into issues that know their
 * step, a human field label and the DOM id of the field to focus.
 */

export interface WizardIssue {
  /** Unique within one validation run. */
  key: string;
  /** Dotted path, e.g. "blindSchedule[2].bigBlind" ("" = the whole configuration). */
  path: string;
  segments: PathSegment[];
  step: StepId;
  /** "Level 3 · big blind". */
  label: string;
  /** Short sentence without the field name, e.g. "Must be at least 1." */
  message: string;
  /** 'server' = returned by the API on save (cleared on the next edit). */
  source: 'local' | 'server';
}

export interface ValidationView {
  ok: boolean;
  issues: WizardIssue[];
  /** Issues keyed by exact path. */
  byPath: ReadonlyMap<string, WizardIssue[]>;
  countByStep: Readonly<Record<StepId, number>>;
  /** The normalized config the server would store (trimmed text, uppercased codes) when valid. */
  normalized: TournamentConfig | null;
}

/** DOM id of the control (or group) that edits `path`. */
export function fieldDomId(path: string): string {
  const slug = path.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `setup-f-${slug || 'root'}`;
}

/** Parent paths of `segments`, most specific first ("a[1].b" → "a[1]" → "a"). */
export function ancestorPaths(segments: readonly PathSegment[]): string[] {
  const out: string[] = [];
  for (let n = segments.length - 1; n >= 1; n--) out.push(formatPath(segments.slice(0, n)));
  return out;
}

const LEVEL_FIELD: Readonly<Record<string, string>> = {
  level: 'level number',
  smallBlind: 'small blind',
  bigBlind: 'big blind',
  ante: 'ante',
  durationSeconds: 'duration',
};

const BREAK_FIELD: Readonly<Record<string, string>> = {
  afterLevel: 'after level',
  everyLevels: 'every N levels',
  durationSeconds: 'duration',
  message: 'message',
};

const LEAF_LABELS: Readonly<Record<string, string>> = {
  name: 'Tournament name',
  joinCode: 'Join code',
  game: 'Game',
  startTime: 'Scheduled start',
  autoStart: 'Auto-start',
  minPlayers: 'Minimum players',
  maxPlayers: 'Maximum players',
  'tables.targetSize': 'Target players per table',
  'tables.maxSize': 'Maximum seats per table',
  'tables.minSize': 'Minimum players per table',
  'tables.finalTableSize': 'Final table size',
  startingStack: 'Starting stack',
  anteType: 'Ante type',
  blindSchedule: 'Blind schedule',
  speedMode: 'Speed mode',
  breaks: 'Breaks',
  'timing.actionTimerSeconds': 'Action timer',
  'timing.awayActionTimerSeconds': 'Away action timer',
  'timing.awayAfterTimeouts': 'Timeouts before away',
  'timing.actionGraceMs': 'Network grace',
  'timing.timeoutBehavior': 'Timeout behaviour',
  'timing.betweenHandsDelayMs': 'Delay between hands',
  'timing.showdownDelayMs': 'Showdown delay',
  'timing.startCountdownSeconds': 'Start countdown',
  'handForHand.autoAtBubble': 'Hand-for-hand at the bubble',
  'registration.fields': 'Registration fields',
  'registration.requireApproval': 'Approval required',
  'registration.accessCode': 'Access code',
  registrationDeadline: 'Registration deadline',
  'lateRegistration.enabled': 'Late registration',
  'lateRegistration.untilLevel': 'Late registration until level',
  'reentry.enabled': 'Re-entry',
  'reentry.maxEntriesPerPlayer': 'Maximum entries per player',
  'reentry.untilLevel': 'Re-entry until level',
  'prizeStructure.currency': 'Currency',
  'prizeStructure.places': 'Paid places',
  'prizeStructure.notes': 'Prize notes',
  'spectators.delaySeconds': 'Spectator delay',
  'balancing.maxImbalance': 'Maximum imbalance',
  'balancing.recentMoveWindowHands': 'Recent-move window',
  'balancing.weights.position': 'Position weight',
  'balancing.weights.blindFairness': 'Blind-fairness weight',
  'balancing.weights.recentMove': 'Recent-move weight',
  'balancing.weights.seatCompatibility': 'Seat-compatibility weight',
  'balancing.consolidateBy': 'Consolidation mode',
};

/** Human label of a configuration path, e.g. "Level 3 · big blind", "Place 2 · amount". */
export function fieldLabel(segments: readonly PathSegment[], config?: TournamentConfig | null): string {
  const [head, a, b, c] = segments;
  if (head === 'blindSchedule' && typeof a === 'number') {
    return typeof b === 'string' ? `Level ${a + 1} · ${LEVEL_FIELD[b] ?? b}` : `Level ${a + 1}`;
  }
  if (head === 'breaks' && typeof a === 'number') {
    return typeof b === 'string' ? `Break ${a + 1} · ${BREAK_FIELD[b] ?? b}` : `Break ${a + 1}`;
  }
  if (head === 'prizeStructure' && a === 'places' && typeof b === 'number') {
    const field = c === 'amountMinor' ? 'amount' : c === 'label' ? 'label' : c === 'position' ? 'position' : null;
    return field ? `Place ${b + 1} · ${field}` : `Place ${b + 1}`;
  }
  if (head === 'registration' && a === 'fields' && typeof b === 'number') {
    const key = config?.registration.fields[b]?.key;
    const name = key ? REGISTRATION_FIELD_LABELS[key] : b >= 0 ? `Field ${b + 1}` : 'Name';
    return typeof c === 'string' ? `${name} field · ${c}` : `${name} field`;
  }
  const exact = LEAF_LABELS[formatPath(segments)];
  if (exact) return exact;
  if (segments.length === 0) return 'Configuration';
  return humanizePath(segments);
}

/** Integers of 4+ digits in validator sentences get thousands separators ("(10000)" → "(10,000)"). */
function prettifyNumbers(message: string): string {
  return message.replace(/(?<![\w.])\d{4,}(?![\w.])/g, (digits) => formatCount(Number(digits)));
}

/** Short, friendly message for a field (type errors of blank inputs read "Enter a number."). */
export function friendlyMessage(issue: Pick<ValidationIssue, 'code' | 'message'>): string {
  if (issue.code === 'invalid_type' && /number|required/i.test(issue.message)) return 'Enter a number.';
  return prettifyNumbers(issue.message);
}

export function toWizardIssues(raw: readonly ValidationIssue[], source: WizardIssue['source'], config?: TournamentConfig | null): WizardIssue[] {
  return raw.map((issue, i) => {
    const segments = Array.isArray(issue.segments) ? [...issue.segments] : [];
    const path = typeof issue.path === 'string' ? issue.path : formatPath(segments);
    return {
      key: `${source}:${i}:${path}`,
      path,
      segments,
      step: stepOfPath(segments),
      label: fieldLabel(segments, config),
      message: friendlyMessage({ code: issue.code ?? 'custom', message: typeof issue.message === 'string' ? issue.message : 'Is invalid.' }),
      source,
    };
  });
}

/** A server-side problem attached to one field (e.g. JOIN_CODE_TAKEN). */
export function serverIssue(segments: PathSegment[], message: string): WizardIssue {
  const path = formatPath(segments);
  return { key: `server:x:${path}`, path, segments, step: stepOfPath(segments), label: fieldLabel(segments), message, source: 'server' };
}

function emptyCounts(): Record<StepId, number> {
  return Object.fromEntries(STEP_IDS.map((s) => [s, 0])) as Record<StepId, number>;
}

/** Validates the draft exactly like the server (plus any issues the server returned on the last save). */
export function validateDraft(config: TournamentConfig, serverIssues: readonly WizardIssue[] = []): ValidationView {
  const result = validateTournamentConfig(config);
  const local = result.ok ? [] : toWizardIssues(result.error.issues, 'local', config);
  if (!result.ok && local.length === 0) {
    local.push({ key: 'local:root', path: '', segments: [], step: 'review', label: 'Configuration', message: result.error.message, source: 'local' });
  }
  const issues = [...local, ...serverIssues];
  const byPath = new Map<string, WizardIssue[]>();
  const countByStep = emptyCounts();
  for (const issue of issues) {
    byPath.set(issue.path, [...(byPath.get(issue.path) ?? []), issue]);
    countByStep[issue.step] += 1;
  }
  return { ok: issues.length === 0, issues, byPath, countByStep, normalized: result.ok ? result.value : null };
}
