/**
 * Structural before/after diff of two JSON values (audit `beforeState` /
 * `afterState`). Both sides are flattened to leaf paths ("timing.actionTimerSeconds",
 * "holds[0]") and compared by their JSON text, so the result is exact and
 * independent of key order.
 */

export type DiffKind = 'added' | 'removed' | 'changed' | 'same';

export interface DiffRow {
  path: string;
  kind: DiffKind;
  /** JSON text of the leaf ('' when absent on that side). */
  before: string;
  after: string;
}

export interface DiffResult {
  rows: DiffRow[];
  changed: number;
  /** True when a side held more leaves than `maxLeaves` (the rest is in the raw view). */
  truncated: boolean;
}

const MAX_DEPTH = 12;
export const MAX_LEAVES = 2_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function json(v: unknown): string {
  if (v === undefined) return '';
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Leaf path → JSON text. Empty objects / arrays are leaves themselves ("{}" / "[]"). */
export function flatten(value: unknown, maxLeaves = MAX_LEAVES): { leaves: Map<string, string>; truncated: boolean } {
  const leaves = new Map<string, string>();
  let truncated = false;
  const walk = (v: unknown, path: string, depth: number): void => {
    if (leaves.size >= maxLeaves) {
      truncated = true;
      return;
    }
    if (depth < MAX_DEPTH && Array.isArray(v) && v.length > 0) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    if (depth < MAX_DEPTH && isPlainObject(v) && Object.keys(v).length > 0) {
      for (const k of Object.keys(v).sort()) walk(v[k], path ? `${path}.${k}` : k, depth + 1);
      return;
    }
    leaves.set(path || '(value)', json(v));
  };
  if (value !== null && value !== undefined) walk(value, '', 0);
  return { leaves, truncated };
}

/** Natural order for paths: "a[2]" before "a[10]". */
function comparePaths(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

export function diffJson(before: unknown, after: unknown, maxLeaves = MAX_LEAVES): DiffResult {
  const b = flatten(before, maxLeaves);
  const a = flatten(after, maxLeaves);
  const paths = [...new Set([...b.leaves.keys(), ...a.leaves.keys()])].sort(comparePaths);
  let changed = 0;
  const rows = paths.map((path): DiffRow => {
    const bv = b.leaves.get(path);
    const av = a.leaves.get(path);
    const kind: DiffKind = bv === undefined ? 'added' : av === undefined ? 'removed' : bv === av ? 'same' : 'changed';
    if (kind !== 'same') changed += 1;
    return { path, kind, before: bv ?? '', after: av ?? '' };
  });
  return { rows, changed, truncated: b.truncated || a.truncated };
}

/** Pretty JSON for the raw view ("null" for a missing snapshot). */
export function prettyJson(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Short one-line summary for list rows: "stack 14,350 → 20,400" or "3 fields changed". */
export function diffSummary(before: unknown, after: unknown): string | null {
  if ((before === null || before === undefined) && (after === null || after === undefined)) return null;
  const d = diffJson(before, after, 200);
  const changes = d.rows.filter((r) => r.kind !== 'same');
  if (changes.length === 0) return 'no change';
  if (changes.length === 1) {
    const r = changes[0]!;
    if (r.kind === 'added') return `${r.path} = ${r.after}`;
    if (r.kind === 'removed') return `${r.path} removed`;
    return `${r.path} ${r.before} → ${r.after}`;
  }
  return `${changes.length} fields changed`;
}
