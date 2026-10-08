import { MUTABLE_WHILE_RUNNING } from '@jpb/shared-types';
import type { TournamentConfig } from '@jpb/shared-types';
import { failure } from '../errors';
import type { PathSegment, ValidationResult } from '../errors';
import { validateTournamentConfig } from './tournamentConfig';
import type { TournamentConfigValidationOptions } from './tournamentConfig';

/**
 * Configuration edits while a tournament runs (docs/ADMIN_CONTROL_ROOM.md
 * §2.2): only the fields listed in shared-types MUTABLE_WHILE_RUNNING may
 * change. The rule set is read from that constant:
 *
 * - "key"                      → the whole top-level field may change;
 * - "key.sub"                  → only that sub-field of `key` may change;
 * - "blindSchedule.futureLevels" → levels after the current level may be
 *   edited, added or removed; levels 1..currentLevel must stay identical.
 *
 * The edited config must also be a valid config on its own.
 */

const FUTURE_LEVELS = 'futureLevels';

export interface RunningEditContext {
  /** Level currently being played (1-based). 0 = no level has started yet. */
  currentLevel: number;
}

/** Deep equality of plain JSON data (key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(rb, k) && jsonEqual(ra[k], rb[k]));
}

interface MutableRules {
  wholeFields: Set<string>;
  subFields: Map<string, Set<string>>;
}

function mutableRules(): MutableRules {
  const wholeFields = new Set<string>();
  const subFields = new Map<string, Set<string>>();
  for (const entry of MUTABLE_WHILE_RUNNING as readonly string[]) {
    const [head, sub] = entry.split('.', 2) as [string, string | undefined];
    if (sub === undefined) wholeFields.add(head);
    else subFields.set(head, (subFields.get(head) ?? new Set<string>()).add(sub));
  }
  return { wholeFields, subFields };
}

type Problem = { segments: PathSegment[]; message: string };

const LOCKED = 'This setting is locked while the tournament is running.';

function checkScheduleEdit(before: TournamentConfig, after: TournamentConfig, currentLevel: number, problems: Problem[]): void {
  const keep = Math.min(currentLevel, before.blindSchedule.length);
  if (after.blindSchedule.length < keep) {
    problems.push({ segments: ['blindSchedule'], message: `Levels 1–${keep} have already been played and cannot be removed.` });
    return;
  }
  for (let i = 0; i < keep; i++) {
    if (!jsonEqual(before.blindSchedule[i], after.blindSchedule[i])) {
      problems.push({ segments: ['blindSchedule', i], message: `Level ${i + 1} has already started and cannot be changed.` });
    }
  }
}

function checkSubFields(
  key: keyof TournamentConfig,
  mutable: Set<string>,
  before: TournamentConfig,
  after: TournamentConfig,
  problems: Problem[],
): void {
  const b = before[key] as unknown as Record<string, unknown>;
  const a = after[key] as unknown as Record<string, unknown>;
  for (const sub of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (!mutable.has(sub) && !jsonEqual(b[sub], a[sub])) problems.push({ segments: [key, sub], message: LOCKED });
  }
}

/**
 * Checks a running-tournament config edit. Returns the normalized new config
 * when the edit is valid and touches only mutable fields; otherwise every
 * offending path. Never throws on bad `after` input.
 */
export function checkRunningConfigEdit(
  before: TournamentConfig,
  after: unknown,
  context: RunningEditContext,
  options: TournamentConfigValidationOptions = {},
): ValidationResult<TournamentConfig> {
  if (!Number.isSafeInteger(context.currentLevel) || context.currentLevel < 0) {
    throw new RangeError(`currentLevel must be a non-negative integer, got ${String(context.currentLevel)}`);
  }
  const parsed = validateTournamentConfig(after, options);
  if (!parsed.ok) return parsed;
  const next = parsed.value;
  const { wholeFields, subFields } = mutableRules();
  const problems: Problem[] = [];
  for (const key of Object.keys(before) as Array<keyof TournamentConfig>) {
    if (wholeFields.has(key)) continue;
    const subs = subFields.get(key);
    if (subs === undefined) {
      if (!jsonEqual(before[key], next[key])) problems.push({ segments: [key], message: LOCKED });
    } else if (key === 'blindSchedule' && subs.has(FUTURE_LEVELS)) {
      checkScheduleEdit(before, next, context.currentLevel, problems);
    } else {
      checkSubFields(key, subs, before, next, problems);
    }
  }
  return problems.length === 0 ? parsed : failure(problems);
}
