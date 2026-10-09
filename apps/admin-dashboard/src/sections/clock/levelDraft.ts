import type { AnteType, BlindLevel, BreakRule } from '@jpb/shared-types';
import { formatChips } from '@jpb/ui';
import { breakRuleAfter } from '../../lib/schedule';

/**
 * Pure model of the inline editor for FUTURE blind levels and breaks
 * (MUTABLE_WHILE_RUNNING `blindSchedule.futureLevels` + `breaks`). Levels up
 * to and including the current one are fixed; the server re-validates
 * everything (packages/validation checkRunningConfigEdit + the director's
 * UPDATE_SCHEDULE), these checks only give instant, field-level feedback.
 */

/** UI limits (the server's absolute limits are wider; these match the setup wizard). */
export const EDIT_LIMITS = {
  maxLevels: 500,
  maxLevelMinutes: 240,
  maxBreakMinutes: 180,
  /** Outside speed mode, levels and breaks last at least one minute (CONFIG_LIMITS.*_NORMAL). */
  minSecondsNormal: 60,
  minSecondsSpeed: 1,
  breakMessageMax: 200,
} as const;

export interface LevelDraft {
  key: string;
  smallBlind: string;
  bigBlind: string;
  ante: string;
  minutes: string;
}

export interface BreakDraft {
  key: string;
  /** Index in the original `breaks` array; null = added in this edit. */
  origin: number | null;
  kind: 'after' | 'every';
  /** afterLevel (kind 'after') or everyLevels (kind 'every'), as typed. */
  at: string;
  minutes: string;
  message: string;
  removed: boolean;
}

export interface ScheduleDraft {
  /** Index of the last fixed level (the current level when editing started). */
  fixedThrough: number;
  levels: LevelDraft[];
  breaks: BreakDraft[];
  /** Counter for new row keys (deterministic; no randomness). */
  seq: number;
}

export interface DraftContext {
  /** The schedule as on the server when editing started. */
  schedule: readonly BlindLevel[];
  breaks: readonly BreakRule[];
  anteType: AnteType;
  speedMode: boolean;
  /** Late registration / re-entry end at these levels: the schedule must keep them. */
  minLevels: number;
  /** Breaks after levels below this number already happened (or are in progress): read-only. */
  editableBreaksFrom: number;
}

export type LevelField = 'smallBlind' | 'bigBlind' | 'ante' | 'minutes';
export type LevelErrors = Partial<Record<LevelField, string>>;
export type BreakField = 'at' | 'minutes' | 'message';
export type BreakErrors = Partial<Record<BreakField, string>>;

export interface DraftValidation {
  levels: Record<string, LevelErrors>;
  breaks: Record<string, BreakErrors>;
  /** Problems that are not about one field (e.g. too few levels). */
  general: string[];
  count: number;
}

// ------------------------------------------------------------------ conversion

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toLevelDraft(l: BlindLevel, key: string): LevelDraft {
  return { key, smallBlind: String(l.smallBlind), bigBlind: String(l.bigBlind), ante: String(l.ante), minutes: String(round2(l.durationSeconds / 60)) };
}

export function toBreakDraft(b: BreakRule, origin: number | null, key: string): BreakDraft {
  const every = b.everyLevels !== undefined;
  return { key, origin, kind: every ? 'every' : 'after', at: String(every ? b.everyLevels : b.afterLevel), minutes: String(round2(b.durationSeconds / 60)), message: b.message ?? '', removed: false };
}

export function createDraft(schedule: readonly BlindLevel[], breaks: readonly BreakRule[], fixedThrough: number): ScheduleDraft {
  const levels = schedule.slice(fixedThrough + 1).map((l, i) => toLevelDraft(l, `l${i}`));
  return { fixedThrough, levels, breaks: breaks.map((b, i) => toBreakDraft(b, i, `b${i}`)), seq: 0 };
}

const wholeNumber = (s: string): number | null => {
  const t = s.replace(/[,\s_]/g, '');
  return /^\d+$/.test(t) ? Number(t) : null;
};
const decimal = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** Seconds from a minutes field ("20", "2.5"); NaN when not a number. */
export function minutesToSeconds(s: string): number {
  const m = decimal(s);
  return m === null ? Number.NaN : Math.round(m * 60);
}

export function fromLevelDraft(d: LevelDraft, level: number): BlindLevel {
  return { level, smallBlind: wholeNumber(d.smallBlind) ?? Number.NaN, bigBlind: wholeNumber(d.bigBlind) ?? Number.NaN, ante: wholeNumber(d.ante) ?? Number.NaN, durationSeconds: minutesToSeconds(d.minutes) };
}

export function fromBreakDraft(d: BreakDraft): BreakRule {
  const at = wholeNumber(d.at) ?? Number.NaN;
  const message = d.message.trim();
  return { ...(d.kind === 'every' ? { everyLevels: at } : { afterLevel: at }), durationSeconds: minutesToSeconds(d.minutes), ...(message ? { message } : {}) };
}

/** Full schedule to send: fixed levels untouched, future levels from the draft (renumbered after the fixed ones). */
export function draftSchedule(ctx: Pick<DraftContext, 'schedule'>, d: ScheduleDraft): BlindLevel[] {
  const fixed = ctx.schedule.slice(0, d.fixedThrough + 1);
  return [...fixed, ...d.levels.map((l, i) => fromLevelDraft(l, fixed.length + i + 1))];
}

export function draftBreaks(d: ScheduleDraft): BreakRule[] {
  return d.breaks.filter((b) => !b.removed).map(fromBreakDraft);
}

/** The break draft shown after `level` (same matching rule as the director: first matching rule wins). */
export function breakDraftAfter(d: ScheduleDraft, level: number): BreakDraft | null {
  const active = d.breaks.filter((b) => !b.removed);
  const found = breakRuleAfter(active.map(fromBreakDraft), level);
  return found ? active[found.index]! : null;
}

// ------------------------------------------------------------------ validation

export function validateDraft(ctx: DraftContext, d: ScheduleDraft): DraftValidation {
  const out: DraftValidation = { levels: {}, breaks: {}, general: [], count: 0 };
  const minSeconds = ctx.speedMode ? EDIT_LIMITS.minSecondsSpeed : EDIT_LIMITS.minSecondsNormal;
  const minText = ctx.speedMode ? 'at least 1 second' : 'at least 1 minute';
  let prevBB = ctx.schedule[d.fixedThrough]?.bigBlind ?? 0;
  const firstNumber = d.fixedThrough + 2;

  d.levels.forEach((l, i) => {
    const e: LevelErrors = {};
    const sb = wholeNumber(l.smallBlind);
    const bb = wholeNumber(l.bigBlind);
    const ante = wholeNumber(l.ante);
    const secs = minutesToSeconds(l.minutes);
    if (sb === null || sb <= 0) e.smallBlind = 'Whole chips above 0';
    if (bb === null || bb <= 0) e.bigBlind = 'Whole chips above 0';
    else if (sb !== null && sb > 0 && bb < sb) e.bigBlind = 'At least the small blind';
    else if (bb < prevBB) e.bigBlind = `Not below level ${firstNumber + i - 1} (${formatChips(prevBB)})`;
    if (ante === null) e.ante = 'Whole chips, 0 for none';
    else if (ctx.anteType === 'NONE' && ante !== 0) e.ante = 'This tournament has no antes (0)';
    if (!Number.isFinite(secs) || secs < minSeconds) e.minutes = `${minText}`;
    else if (secs > EDIT_LIMITS.maxLevelMinutes * 60) e.minutes = `At most ${EDIT_LIMITS.maxLevelMinutes} minutes`;
    if (bb !== null && bb > 0) prevBB = Math.max(prevBB, bb);
    if (Object.keys(e).length) {
      out.levels[l.key] = e;
      out.count += Object.keys(e).length;
    }
  });

  const total = d.fixedThrough + 1 + d.levels.length;
  if (total < ctx.minLevels) out.general.push(`Keep at least ${ctx.minLevels} levels: late registration or re-entry runs until level ${ctx.minLevels}.`);
  if (total > EDIT_LIMITS.maxLevels) out.general.push(`At most ${EDIT_LIMITS.maxLevels} levels.`);

  const active = d.breaks.filter((b) => !b.removed);
  const rules = active.map(fromBreakDraft);
  active.forEach((b, i) => {
    const e: BreakErrors = {};
    const at = wholeNumber(b.at);
    const secs = minutesToSeconds(b.minutes);
    const original = b.origin === null ? null : (ctx.breaks[b.origin] ?? null);
    const changed = original === null || JSON.stringify(fromBreakDraft(b)) !== JSON.stringify(original);
    if (at === null || at < 1 || at > total) e.at = `A level between 1 and ${total}`;
    else if (changed && b.kind === 'after' && at < ctx.editableBreaksFrom) e.at = `Level ${at} has already been played`;
    else if (b.kind === 'after' && at === total) e.at = 'The last level never ends; choose an earlier level';
    if (!Number.isFinite(secs) || secs < minSeconds) e.minutes = minText;
    else if (secs > EDIT_LIMITS.maxBreakMinutes * 60) e.minutes = `At most ${EDIT_LIMITS.maxBreakMinutes} minutes`;
    if (b.message.trim().length > EDIT_LIMITS.breakMessageMax) e.message = `At most ${EDIT_LIMITS.breakMessageMax} characters`;
    if (!e.at && at !== null) {
      for (let level = 1; level <= total; level++) {
        const first = breakRuleAfter(rules, level);
        const matches = b.kind === 'after' ? level === at : level % at === 0;
        if (matches && first && first.index !== i) {
          e.at = `Overlaps the break after level ${level}`;
          break;
        }
      }
    }
    if (Object.keys(e).length) {
      out.breaks[b.key] = e;
      out.count += Object.keys(e).length;
    }
  });
  out.count += out.general.length;
  return out;
}

// ------------------------------------------------------------------ edits (pure)

const nextKey = (d: ScheduleDraft, prefix: string): [string, number] => [`${prefix}${d.seq + 1}`, d.seq + 1];

export function updateLevel(d: ScheduleDraft, key: string, patch: Partial<Omit<LevelDraft, 'key'>>): ScheduleDraft {
  return { ...d, levels: d.levels.map((l) => (l.key === key ? { ...l, ...patch } : l)) };
}

export function updateBreak(d: ScheduleDraft, key: string, patch: Partial<Omit<BreakDraft, 'key' | 'origin'>>): ScheduleDraft {
  return { ...d, breaks: d.breaks.map((b) => (b.key === key ? { ...b, ...patch } : b)) };
}

/** Shift one-off breaks so they stay attached to the same level when levels are inserted/removed before them. */
function shiftBreaks(breaks: BreakDraft[], fromLevel: number, by: 1 | -1, minLevel: number): BreakDraft[] {
  return breaks.map((b) => {
    if (b.removed || b.kind !== 'after') return b;
    const at = wholeNumber(b.at);
    if (at === null) return b;
    if (by === 1 && at > fromLevel) return { ...b, at: String(at + 1) };
    if (by === -1 && at > fromLevel) return { ...b, at: String(at - 1) };
    if (by === -1 && at === fromLevel) return { ...b, at: String(Math.max(minLevel, at - 1)) };
    return b;
  });
}

const niceRound = (n: number) => (n >= 10_000 ? Math.round(n / 1000) * 1000 : n >= 1000 ? Math.round(n / 500) * 500 : n >= 100 ? Math.round(n / 50) * 50 : Math.max(1, Math.round(n)));

/**
 * A starting point for a new level after `prev`: halfway to `next` when a
 * later level exists (so the big blind never decreases), else +50% blinds;
 * same duration, ante scaled with the big blind.
 */
export function nextLevelGuess(prev: BlindLevel, anteType: AnteType, next?: BlindLevel): Omit<LevelDraft, 'key'> {
  const base = Number.isFinite(prev.bigBlind) && prev.bigBlind > 0 ? prev.bigBlind : 100;
  const upper = next && Number.isFinite(next.bigBlind) && next.bigBlind > base ? next.bigBlind : null;
  const bb = upper !== null ? Math.min(upper, Math.max(base, niceRound((base + upper) / 2))) : Math.max(base + 1, niceRound(base * 1.5));
  const sb = Math.max(1, Math.min(bb, niceRound(bb / 2)));
  const ante = anteType === 'NONE' ? 0 : prev.ante > 0 ? niceRound((prev.ante / base) * bb) : 0;
  const secs = Number.isFinite(prev.durationSeconds) && prev.durationSeconds > 0 ? prev.durationSeconds : 1200;
  return { smallBlind: String(sb), bigBlind: String(bb), ante: String(ante), minutes: String(round2(secs / 60)) };
}

/** Insert a level after position `afterPos` in the draft (-1 = right after the current level). */
export function insertLevel(ctx: DraftContext, d: ScheduleDraft, afterPos: number): ScheduleDraft {
  const schedule = draftSchedule(ctx, d);
  const prev = schedule[d.fixedThrough + 1 + afterPos] ?? schedule[schedule.length - 1]!;
  const next = schedule[d.fixedThrough + 2 + afterPos];
  const [key, seq] = nextKey(d, 'n');
  const levels = [...d.levels.slice(0, afterPos + 1), { key, ...nextLevelGuess(prev, ctx.anteType, next) }, ...d.levels.slice(afterPos + 1)];
  const levelNumber = d.fixedThrough + 2 + afterPos; // number of the level the new one follows
  return { ...d, seq, levels, breaks: shiftBreaks(d.breaks, levelNumber, 1, ctx.editableBreaksFrom) };
}

export function removeLevel(ctx: DraftContext, d: ScheduleDraft, key: string): ScheduleDraft {
  const pos = d.levels.findIndex((l) => l.key === key);
  if (pos < 0) return d;
  const levelNumber = d.fixedThrough + 2 + pos;
  return { ...d, levels: d.levels.filter((l) => l.key !== key), breaks: shiftBreaks(d.breaks, levelNumber, -1, ctx.editableBreaksFrom) };
}

export function addBreakAfter(d: ScheduleDraft, level: number, durationSeconds: number): ScheduleDraft {
  const [key, seq] = nextKey(d, 'nb');
  return { ...d, seq, breaks: [...d.breaks, { key, origin: null, kind: 'after', at: String(level), minutes: String(round2(durationSeconds / 60)), message: '', removed: false }] };
}

export function removeBreak(d: ScheduleDraft, key: string): ScheduleDraft {
  const b = d.breaks.find((x) => x.key === key);
  if (!b) return d;
  if (b.origin === null) return { ...d, breaks: d.breaks.filter((x) => x.key !== key) };
  return updateBreak(d, key, { removed: true });
}

export function restoreBreaks(d: ScheduleDraft): ScheduleDraft {
  return { ...d, breaks: d.breaks.map((b) => (b.removed ? { ...b, removed: false } : b)) };
}

// ------------------------------------------------------------------ result & preview

export interface RunningScheduleChanges {
  blindSchedule?: BlindLevel[];
  breaks?: BreakRule[];
}

/** Only the fields that actually changed (empty object = nothing to save). */
export function draftChanges(ctx: DraftContext, d: ScheduleDraft): RunningScheduleChanges {
  const schedule = draftSchedule(ctx, d);
  const breaks = draftBreaks(d);
  return {
    ...(JSON.stringify(schedule) !== JSON.stringify(ctx.schedule) ? { blindSchedule: schedule } : {}),
    ...(JSON.stringify(breaks) !== JSON.stringify(ctx.breaks) ? { breaks } : {}),
  };
}

export function levelText(l: BlindLevel | undefined): string {
  if (!l) return '—';
  const mins = round2(l.durationSeconds / 60);
  return `${formatChips(l.smallBlind)} / ${formatChips(l.bigBlind)}${l.ante ? ` · ante ${formatChips(l.ante)}` : ''} · ${mins} min`;
}

export function breakName(b: BreakRule): string {
  return b.everyLevels !== undefined ? `Break every ${b.everyLevels} levels` : `Break after level ${b.afterLevel}`;
}

const breakText = (b: BreakRule) => `${round2(b.durationSeconds / 60)} min${b.message ? ` · “${b.message}”` : ''}`;

export interface DiffRow {
  label: string;
  before: string;
  after: string;
}

/** Before → after rows for the level-2 confirmation (future levels and breaks only). */
export function scheduleDiff(before: readonly BlindLevel[], after: readonly BlindLevel[], breaksBefore: readonly BreakRule[], d: ScheduleDraft): DiffRow[] {
  const rows: DiffRow[] = [];
  if (before.length !== after.length) rows.push({ label: 'Levels in the schedule', before: String(before.length), after: String(after.length) });
  const n = Math.max(before.length, after.length);
  for (let i = d.fixedThrough + 1; i < n; i++) {
    const a = before[i];
    const b = after[i];
    if (JSON.stringify(a) !== JSON.stringify(b)) rows.push({ label: `Level ${i + 1}`, before: a ? levelText(a) : 'not scheduled', after: b ? levelText(b) : 'removed' });
  }
  for (const bd of d.breaks) {
    const original = bd.origin === null ? null : breaksBefore[bd.origin];
    if (bd.removed && original) {
      rows.push({ label: breakName(original), before: breakText(original), after: 'removed' });
      continue;
    }
    const next = fromBreakDraft(bd);
    if (!original) rows.push({ label: breakName(next), before: 'no break', after: breakText(next) });
    else if (JSON.stringify(original) !== JSON.stringify(next)) rows.push({ label: breakName(original), before: breakText(original), after: `${breakName(next) !== breakName(original) ? `${breakName(next).replace('Break ', '')} · ` : ''}${breakText(next)}` });
  }
  return rows;
}
