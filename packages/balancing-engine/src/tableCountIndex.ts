import { effectivePlayerCount } from '@jpb/seating-engine';
import type { TableId, TableSummary } from '@jpb/shared-types';
import { MAX_ORDERED_INT, OrderedIntSet } from './orderedIntSet';

/** Largest effective player count the index accepts (far above ABSOLUTE_MAX_SEATS; guards memory). */
export const MAX_INDEXED_COUNT = 1024;

export type IndexedTableState = 'ACTIVE' | 'BREAKING';

export interface IndexEntry {
  tableId: TableId;
  tableNumber: number;
  /** Effective players (staying + reserved). Always 0 for BREAKING tables (they are not bucketed). */
  count: number;
  state: IndexedTableState;
}

export type IndexOrder = 'ASC' | 'DESC';

/**
 * Size index over all open tables, used by the balancing planner.
 *
 * ACTIVE tables are bucketed by effective player count; each bucket is an
 * OrderedIntSet of table numbers, so "the table with count c and the lowest /
 * highest table number" is found in O(log32 T) (≈ constant). minCount() and
 * maxCount() are O(1) (cached). Updates are O(log32 T). BREAKING tables are
 * tracked separately (they are neither sources nor destinations).
 *
 * The index is a derived cache (rebuild with fromTables at any time); it is a
 * mutable class and must never be stored inside serialisable state.
 */
export class TableCountIndex {
  private readonly entries = new Map<TableId, IndexEntry>();
  private readonly idByNumber = new Map<number, TableId>();
  private readonly buckets: OrderedIntSet[] = [];
  private readonly breaking = new OrderedIntSet();
  private activeCount = 0;
  private players = 0;
  private minC = -1;
  private maxC = -1;

  /** Build from summaries: ACTIVE → bucketed, BREAKING → tracked, CLOSED → ignored. O(T). */
  static fromTables(tables: Iterable<TableSummary>): TableCountIndex {
    const index = new TableCountIndex();
    for (const t of tables) index.upsert(t);
    return index;
  }

  /** Refresh one table from its summary (CLOSED removes it). */
  upsert(table: TableSummary): void {
    if (table.status === 'CLOSED') this.remove(table.tableId);
    else if (table.status === 'BREAKING') this.setBreaking(table.tableId, table.tableNumber);
    else this.setActive(table.tableId, table.tableNumber, effectivePlayerCount(table));
  }

  setActive(tableId: TableId, tableNumber: number, count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_INDEXED_COUNT) {
      throw new RangeError(`count must be an integer in [0, ${MAX_INDEXED_COUNT}], got ${count}`);
    }
    this.place(tableId, tableNumber);
    this.entries.set(tableId, { tableId, tableNumber, count, state: 'ACTIVE' });
    this.bucket(count).add(tableNumber);
    this.activeCount += 1;
    this.players += count;
    if (this.minC === -1 || count < this.minC) this.minC = count;
    if (count > this.maxC) this.maxC = count;
  }

  setBreaking(tableId: TableId, tableNumber: number): void {
    this.place(tableId, tableNumber);
    this.entries.set(tableId, { tableId, tableNumber, count: 0, state: 'BREAKING' });
    this.breaking.add(tableNumber);
  }

  /** Removes the table; returns false when it was not indexed. */
  remove(tableId: TableId): boolean {
    const entry = this.entries.get(tableId);
    if (entry === undefined) return false;
    this.entries.delete(tableId);
    this.idByNumber.delete(entry.tableNumber);
    if (entry.state === 'BREAKING') {
      this.breaking.delete(entry.tableNumber);
      return true;
    }
    const bucket = this.buckets[entry.count] as OrderedIntSet;
    bucket.delete(entry.tableNumber);
    this.activeCount -= 1;
    this.players -= entry.count;
    if (bucket.size === 0) this.refreshBounds();
    return true;
  }

  /** Removes any previous entry of the table and validates the table number. */
  private place(tableId: TableId, tableNumber: number): void {
    if (!Number.isSafeInteger(tableNumber) || tableNumber < 0 || tableNumber > MAX_ORDERED_INT) {
      throw new RangeError(`tableNumber must be an integer in [0, ${MAX_ORDERED_INT}], got ${tableNumber}`);
    }
    const holder = this.idByNumber.get(tableNumber);
    if (holder !== undefined && holder !== tableId) {
      throw new Error(`tableNumber ${tableNumber} is already used by table ${holder}`);
    }
    this.remove(tableId);
    this.idByNumber.set(tableNumber, tableId);
  }

  private bucket(count: number): OrderedIntSet {
    while (this.buckets.length <= count) this.buckets.push(new OrderedIntSet());
    return this.buckets[count] as OrderedIntSet;
  }

  private refreshBounds(): void {
    if (this.activeCount === 0) {
      this.minC = -1;
      this.maxC = -1;
      return;
    }
    while ((this.buckets[this.minC]?.size ?? 0) === 0) this.minC += 1;
    while ((this.buckets[this.maxC]?.size ?? 0) === 0) this.maxC -= 1;
  }

  get(tableId: TableId): Readonly<IndexEntry> | undefined {
    return this.entries.get(tableId);
  }

  has(tableId: TableId): boolean {
    return this.entries.has(tableId);
  }

  tableIdForNumber(tableNumber: number): TableId | undefined {
    return this.idByNumber.get(tableNumber);
  }

  /** ACTIVE tables. */
  get activeTableCount(): number {
    return this.activeCount;
  }

  get breakingTableCount(): number {
    return this.breaking.size;
  }

  /** ACTIVE + BREAKING (every table that is not CLOSED). */
  get openTableCount(): number {
    return this.activeCount + this.breaking.size;
  }

  /** Σ effective players over ACTIVE tables. */
  get totalActivePlayers(): number {
    return this.players;
  }

  /** Smallest effective count among ACTIVE tables, or null when none. O(1). */
  minCount(): number | null {
    return this.minC === -1 ? null : this.minC;
  }

  /** Largest effective count among ACTIVE tables, or null when none. O(1). */
  maxCount(): number | null {
    return this.maxC === -1 ? null : this.maxC;
  }

  /** Number of ACTIVE tables with exactly `count` players. */
  tablesWithCountSize(count: number): number {
    return this.buckets[count]?.size ?? 0;
  }

  /** ACTIVE table with `count` players and the lowest table number, or null. */
  firstWithCount(count: number): TableId | null {
    const n = this.buckets[count]?.first() ?? -1;
    return n === -1 ? null : (this.idByNumber.get(n) as TableId);
  }

  /** ACTIVE table with `count` players and the highest table number, or null. */
  lastWithCount(count: number): TableId | null {
    const n = this.buckets[count]?.last() ?? -1;
    return n === -1 ? null : (this.idByNumber.get(n) as TableId);
  }

  /** ACTIVE tables with `count` players ordered by table number. Safe against updates of already-yielded tables. */
  *tablesWithCount(count: number, order: IndexOrder = 'ASC'): IterableIterator<TableId> {
    const bucket = this.buckets[count];
    if (bucket === undefined) return;
    const ascending = order === 'ASC';
    let n = ascending ? bucket.first() : bucket.last();
    while (n !== -1) {
      yield this.idByNumber.get(n) as TableId;
      n = ascending ? bucket.next(n) : bucket.prev(n);
    }
  }

  /** BREAKING tables ordered by table number ascending. */
  *breakingTables(): IterableIterator<TableId> {
    for (const n of this.breaking.ascending()) yield this.idByNumber.get(n) as TableId;
  }

  /** Every entry ordered by table number (plain JSON; for admin views, debugging and tests). O(T log T). */
  snapshot(): IndexEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e })).sort((a, b) => a.tableNumber - b.tableNumber);
  }

  clone(): TableCountIndex {
    const copy = new TableCountIndex();
    for (const [id, e] of this.entries) copy.entries.set(id, { ...e });
    for (const [n, id] of this.idByNumber) copy.idByNumber.set(n, id);
    for (const b of this.buckets) copy.buckets.push(b.clone());
    for (const n of this.breaking.ascending()) copy.breaking.add(n);
    copy.activeCount = this.activeCount;
    copy.players = this.players;
    copy.minC = this.minC;
    copy.maxC = this.maxC;
    return copy;
  }

  /** Internal consistency check (empty when healthy). O(T). */
  checkInvariants(): string[] {
    const problems: string[] = [];
    let active = 0;
    let players = 0;
    let breaking = 0;
    let min = -1;
    let max = -1;
    for (const e of this.entries.values()) {
      if (this.idByNumber.get(e.tableNumber) !== e.tableId) problems.push(`number map broken for ${e.tableId}`);
      if (e.state === 'BREAKING') {
        breaking += 1;
        if (!this.breaking.has(e.tableNumber)) problems.push(`${e.tableId} missing from breaking set`);
        continue;
      }
      active += 1;
      players += e.count;
      if (!this.buckets[e.count]?.has(e.tableNumber)) problems.push(`${e.tableId} missing from bucket ${e.count}`);
      if (min === -1 || e.count < min) min = e.count;
      if (e.count > max) max = e.count;
    }
    const bucketTotal = this.buckets.reduce((sum, b) => sum + b.size, 0);
    if (bucketTotal !== active) problems.push(`bucket sizes ${bucketTotal} != active tables ${active}`);
    if (this.breaking.size !== breaking) problems.push(`breaking set size ${this.breaking.size} != ${breaking}`);
    if (this.idByNumber.size !== this.entries.size) problems.push('number map size mismatch');
    if (active !== this.activeCount) problems.push(`activeCount ${this.activeCount} != ${active}`);
    if (players !== this.players) problems.push(`players ${this.players} != ${players}`);
    if (min !== this.minC || max !== this.maxC) problems.push(`bounds [${this.minC}, ${this.maxC}] != [${min}, ${max}]`);
    return problems;
  }
}
