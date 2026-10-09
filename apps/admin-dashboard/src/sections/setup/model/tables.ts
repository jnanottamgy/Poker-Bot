import type { BalancingConfig, TableSizeConfig } from '@jpb/shared-types';
import { formatCount } from '@jpb/ui';
import { isNum } from './format';

export type ConsolidateBy = BalancingConfig['consolidateBy'];

/** Above the final-table size play is spread over at least this many tables (@jpb/seating-engine MIN_TABLES_BEFORE_FINAL). */
export const MIN_TABLES_BEFORE_FINAL = 2;

export interface TablePreset {
  id: '6max' | '8max' | '9max';
  label: string;
  caption: string;
  sizes: Pick<TableSizeConfig, 'targetSize' | 'maxSize' | 'finalTableSize'>;
}

/**
 * Table-size presets. 9-max keeps the spec default (8-handed target, 9 seats,
 * 9-handed final table) so balancing has a free seat to move players into.
 */
export const TABLE_PRESETS: readonly TablePreset[] = [
  { id: '6max', label: '6-max', caption: '6 seats · plays 6-handed · final table 6', sizes: { targetSize: 6, maxSize: 6, finalTableSize: 6 } },
  { id: '8max', label: '8-max', caption: '8 seats · plays 8-handed · final table 8', sizes: { targetSize: 8, maxSize: 8, finalTableSize: 8 } },
  { id: '9max', label: '9-max', caption: '9 seats · plays 8-handed · final table 9', sizes: { targetSize: 8, maxSize: 9, finalTableSize: 9 } },
];

export function matchingPreset(t: TableSizeConfig): TablePreset | null {
  return TABLE_PRESETS.find((p) => p.sizes.targetSize === t.targetSize && p.sizes.maxSize === t.maxSize && p.sizes.finalTableSize === t.finalTableSize) ?? null;
}

/** Applies a preset; the minimum table size is lowered when it would exceed the new target. */
export function applyTablePreset(t: TableSizeConfig, preset: TablePreset): TableSizeConfig {
  return { ...t, ...preset.sizes, minSize: isNum(t.minSize) ? Math.min(t.minSize, preset.sizes.targetSize) : 2 };
}

function sizesUsable(cfg: TableSizeConfig): boolean {
  const { targetSize, maxSize, minSize, finalTableSize } = cfg;
  return [targetSize, maxSize, minSize, finalTableSize].every((n) => isNum(n) && Number.isInteger(n) && n >= 1) && minSize <= targetSize && targetSize <= maxSize && finalTableSize <= maxSize;
}

/**
 * Number of tables for `players` — mirror of the normative @jpb/seating-engine
 * `computeTableCount` (README "Table count"):
 *
 *   players <= finalTableSize → 1
 *   otherwise T = max(2, ceil(n / maxSize), min(ceil(n / d), floor(n / minSize)))
 *   d = targetSize ('TARGET') or maxSize ('MAX')
 *
 * Display only (the director seats players on the server); a test proves it
 * matches the engine. Null when the table sizes are not valid yet.
 */
export function tableCount(players: number, cfg: TableSizeConfig, consolidateBy: ConsolidateBy): number | null {
  if (!sizesUsable(cfg) || !isNum(players) || players < 0) return null;
  if (players === 0) return 0;
  if (players <= cfg.finalTableSize) return 1;
  const d = consolidateBy === 'MAX' ? cfg.maxSize : cfg.targetSize;
  return Math.max(MIN_TABLES_BEFORE_FINAL, Math.ceil(players / cfg.maxSize), Math.min(Math.ceil(players / d), Math.floor(players / cfg.minSize)));
}

export interface SeatingPreview {
  players: number;
  tables: number;
  /** Balanced sizes (@jpb/seating-engine `distributeSizes`): the first n mod T tables get one more player. */
  groups: Array<{ size: number; count: number }>;
}

export function seatingPreview(players: number, cfg: TableSizeConfig, consolidateBy: ConsolidateBy): SeatingPreview | null {
  const tables = tableCount(players, cfg, consolidateBy);
  if (tables === null) return null;
  if (tables === 0) return { players, tables, groups: [] };
  const base = Math.floor(players / tables);
  const extra = players % tables;
  const groups = [
    { size: base + 1, count: extra },
    { size: base, count: tables - extra },
  ].filter((g) => g.count > 0);
  return { players, tables, groups };
}

/** "100 players → 13 tables (9 × 8, 4 × 7)". */
export function seatingText(p: SeatingPreview): string {
  if (p.tables === 0) return 'No players to seat';
  const sizes = p.groups.map((g) => `${formatCount(g.count)} × ${g.size}`).join(', ');
  return `${formatCount(p.players)} player${p.players === 1 ? '' : 's'} → ${formatCount(p.tables)} table${p.tables === 1 ? '' : 's'} (${sizes})`;
}

/** Table sizes of a preview, largest first, expanded for drawing (at most `limit` tables). */
export function previewTables(p: SeatingPreview, limit: number): number[] {
  const out: number[] = [];
  for (const g of p.groups) for (let i = 0; i < g.count && out.length < limit; i++) out.push(g.size);
  return out;
}

const SAMPLE_COUNTS = [10, 50, 100, 1_000, 10_000, 100_000, 1_000_000];

/** Field sizes worth previewing for this config: the min, the max and round numbers between. */
export function sampleFieldSizes(minPlayers: number, maxPlayers: number): number[] {
  if (!isNum(minPlayers) || !isNum(maxPlayers) || maxPlayers < minPlayers) return [];
  const set = new Set<number>([minPlayers, maxPlayers]);
  for (const n of SAMPLE_COUNTS) if (n > minPlayers && n < maxPlayers) set.add(n);
  return [...set].sort((a, b) => a - b);
}
