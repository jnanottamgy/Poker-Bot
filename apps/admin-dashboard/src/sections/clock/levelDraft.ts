import type { BlindLevel, BreakRule } from '@jpb/shared-types';
import { formatChips } from '@jpb/ui';

/**
 * Pure helpers for inline editing of FUTURE blind levels and breaks
 * (MUTABLE_WHILE_RUNNING). The server re-validates everything.
 */
export interface LevelDraft {
  level: number;
  smallBlind: string;
  bigBlind: string;
  ante: string;
  minutes: string;
}

export interface BreakDraft {
  index: number;
  minutes: string;
  message: string;
}

export type LevelErrors = Partial<Record<'smallBlind' | 'bigBlind' | 'ante' | 'minutes', string>>;

const MAX_MINUTES = 240;

export function toLevelDraft(l: BlindLevel): LevelDraft {
  return { level: l.level, smallBlind: String(l.smallBlind), bigBlind: String(l.bigBlind), ante: String(l.ante), minutes: String(Math.round((l.durationSeconds / 60) * 100) / 100) };
}

export function toBreakDraft(b: BreakRule, index: number): BreakDraft {
  return { index, minutes: String(Math.round(b.durationSeconds / 60)), message: b.message ?? '' };
}

const int = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

export function validateLevel(d: LevelDraft): LevelErrors {
  const e: LevelErrors = {};
  const sb = int(d.smallBlind);
  const bb = int(d.bigBlind);
  const ante = int(d.ante);
  const min = Number(d.minutes);
  if (sb === null || sb <= 0) e.smallBlind = 'Whole number above 0';
  if (bb === null || bb <= 0) e.bigBlind = 'Whole number above 0';
  else if (sb !== null && bb < sb) e.bigBlind = 'Must be ≥ small blind';
  if (ante === null) e.ante = 'Whole number, 0 for none';
  if (!Number.isFinite(min) || min < 1 || min > MAX_MINUTES) e.minutes = `1–${MAX_MINUTES} minutes`;
  return e;
}

export function validateBreak(d: BreakDraft): string | null {
  const min = int(d.minutes);
  if (min === null || min < 1 || min > 180) return '1–180 minutes';
  return null;
}

export function hasErrors(levels: LevelDraft[], breaks: BreakDraft[]): boolean {
  return levels.some((l) => Object.keys(validateLevel(l)).length > 0) || breaks.some((b) => validateBreak(b) !== null);
}

export function fromLevelDraft(d: LevelDraft): BlindLevel {
  return { level: d.level, smallBlind: Number(d.smallBlind), bigBlind: Number(d.bigBlind), ante: Number(d.ante), durationSeconds: Math.round(Number(d.minutes) * 60) };
}

/** Full schedule to send: past + current levels untouched, future levels from the draft (renumbered). */
export function mergeSchedule(schedule: readonly BlindLevel[], currentIndex: number, future: LevelDraft[]): BlindLevel[] {
  const fixed = schedule.slice(0, currentIndex + 1);
  return [...fixed, ...future.map((d, i) => ({ ...fromLevelDraft(d), level: fixed.length + i + 1 }))];
}

export function mergeBreaks(breaks: readonly BreakRule[], drafts: BreakDraft[]): BreakRule[] {
  return breaks.map((b, i) => {
    const d = drafts.find((x) => x.index === i);
    if (!d) return b;
    const message = d.message.trim();
    return { ...b, durationSeconds: Number(d.minutes) * 60, ...(message ? { message } : { message: undefined }) };
  });
}

/** A new level appended after the last one (+50% blinds, same duration) as an editing starting point. */
export function nextLevelGuess(last: LevelDraft | BlindLevel, level: number): LevelDraft {
  const l = 'durationSeconds' in last ? last : fromLevelDraft(last);
  const round = (n: number) => (n >= 1000 ? Math.round(n / 500) * 500 : Math.round(n / 50) * 50);
  const bb = round(l.bigBlind * 1.5);
  return toLevelDraft({ level, smallBlind: Math.max(1, round(bb / 2)), bigBlind: bb, ante: l.ante > 0 ? bb : 0, durationSeconds: l.durationSeconds });
}

const levelText = (l: BlindLevel | undefined) => (l ? `${formatChips(l.smallBlind)} / ${formatChips(l.bigBlind)} · ante ${formatChips(l.ante)} · ${Math.round(l.durationSeconds / 60)} min` : '—');

/** Before → after rows for the level-2 confirmation. */
export function scheduleDiff(before: readonly BlindLevel[], after: readonly BlindLevel[], breaksBefore: readonly BreakRule[], breaksAfter: readonly BreakRule[]) {
  const rows: Array<{ label: string; before: string; after: string }> = [];
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const a = before[i];
    const b = after[i];
    if (JSON.stringify(a) !== JSON.stringify(b)) rows.push({ label: `Level ${i + 1}`, before: a ? levelText(a) : 'not scheduled', after: b ? levelText(b) : 'removed' });
  }
  breaksBefore.forEach((br, i) => {
    const nb = breaksAfter[i];
    if (nb && JSON.stringify(br) !== JSON.stringify(nb)) {
      const name = br.everyLevels ? `Break every ${br.everyLevels} levels` : `Break after level ${br.afterLevel}`;
      rows.push({ label: name, before: `${Math.round(br.durationSeconds / 60)} min`, after: `${Math.round(nb.durationSeconds / 60)} min${nb.message !== br.message ? ' · new message' : ''}` });
    }
  });
  return rows;
}
