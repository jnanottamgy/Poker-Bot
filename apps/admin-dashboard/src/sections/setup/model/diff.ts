import type { TournamentConfig } from '@jpb/shared-types';
import { formatCount } from '@jpb/ui';
import { formatPath, jsonEqual } from '@jpb/validation';
import type { PathSegment } from '@jpb/validation';
import { fieldLabel } from './issues';
import { stepOfPath } from './steps';
import type { StepId } from './steps';

/**
 * What an edit changes, for the "unsaved changes" list and the save
 * confirmation. Leaves are compared as plain JSON; long lists (levels,
 * places) are summarized instead of listed value by value.
 */

export interface ConfigChange {
  path: string;
  step: StepId;
  label: string;
  before: string;
  after: string;
}

/** Arrays summarized as a whole ("20 levels → 22 levels, edited"). */
const SUMMARIZED_ARRAYS: Readonly<Record<string, { one: string; many: string }>> = {
  blindSchedule: { one: 'level', many: 'levels' },
  breaks: { one: 'break', many: 'breaks' },
  'prizeStructure.places': { one: 'paid place', many: 'paid places' },
  'registration.fields': { one: 'field', many: 'fields' },
};

function valueText(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (typeof v === 'number') return Number.isFinite(v) ? formatCount(v) : '—';
  if (typeof v === 'string') return v === '' ? '—' : `“${v.length > 40 ? `${v.slice(0, 40)}…` : v}”`;
  return JSON.stringify(v).slice(0, 40);
}

function collect(before: unknown, after: unknown, segments: PathSegment[], out: ConfigChange[]): void {
  if (jsonEqual(before, after)) return;
  const path = formatPath(segments);
  const summarized = SUMMARIZED_ARRAYS[path];
  if (summarized && Array.isArray(before) && Array.isArray(after)) {
    const n = (x: unknown[]) => `${formatCount(x.length)} ${x.length === 1 ? summarized.one : summarized.many}`;
    out.push({ path, step: stepOfPath(segments), label: fieldLabel(segments), before: n(before), after: `${n(after)}${before.length === after.length ? ' (edited)' : ''}` });
    return;
  }
  const isObj = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (isObj(before) && isObj(after)) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) collect(b[key], a[key], [...segments, key], out);
    return;
  }
  out.push({ path, step: stepOfPath(segments), label: fieldLabel(segments), before: valueText(before), after: valueText(after) });
}

export function configChanges(before: TournamentConfig, after: TournamentConfig): ConfigChange[] {
  const out: ConfigChange[] = [];
  collect(before, after, [], out);
  return out;
}
