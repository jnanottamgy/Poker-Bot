/**
 * Ordered set of non-negative integers backed by a hierarchical bitset
 * (32-ary summary tree over Uint32Array words).
 *
 * level[0] bit i       = i is a member
 * level[k+1] bit w     = level[k] word w is non-zero
 *
 * add / delete / has / first / last / next / prev all cost O(levels), where
 * levels = ceil(log32(capacity)) — 4 levels cover 1,048,576 values — so they
 * are effectively constant time. Memory ≈ capacity / 8 bytes (+3%). Capacity
 * grows on demand (amortised O(1)).
 */

/** Largest member value supported (2^24 - 1); keeps memory bounded (≈2 MiB per set at the limit). */
export const MAX_ORDERED_INT = 0xffffff;

const MIN_CAPACITY = 1024;

function ctz(word: number): number {
  return 31 - Math.clz32(word & -word);
}

function highestBit(word: number): number {
  return 31 - Math.clz32(word);
}

function buildLevels(level0: Uint32Array): Uint32Array[] {
  const levels = [level0];
  let below = level0;
  while (below.length > 1) {
    const above = new Uint32Array(Math.ceil(below.length / 32));
    for (let w = 0; w < below.length; w += 1) {
      if (below[w] !== 0) above[w >>> 5] = ((above[w >>> 5] as number) | (1 << (w & 31))) >>> 0;
    }
    levels.push(above);
    below = above;
  }
  return levels;
}

export class OrderedIntSet {
  private levels: Uint32Array[];
  private capacity: number;
  private count = 0;

  constructor(initialCapacity = MIN_CAPACITY) {
    this.capacity = Math.max(MIN_CAPACITY, Math.ceil(initialCapacity / 32) * 32);
    this.levels = buildLevels(new Uint32Array(this.capacity / 32));
  }

  get size(): number {
    return this.count;
  }

  private assertValue(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ORDERED_INT) {
      throw new RangeError(`OrderedIntSet value must be an integer in [0, ${MAX_ORDERED_INT}], got ${value}`);
    }
  }

  private grow(minCapacity: number): void {
    let cap = this.capacity;
    while (cap < minCapacity) cap *= 2;
    cap = Math.min(cap, Math.ceil((MAX_ORDERED_INT + 1) / 32) * 32);
    const level0 = new Uint32Array(cap / 32);
    level0.set(this.levels[0] as Uint32Array);
    this.capacity = cap;
    this.levels = buildLevels(level0);
  }

  has(value: number): boolean {
    if (!Number.isSafeInteger(value) || value < 0 || value >= this.capacity) return false;
    return (((this.levels[0] as Uint32Array)[value >>> 5] as number) & (1 << (value & 31))) !== 0;
  }

  /** Returns true when the value was added (false when already present). */
  add(value: number): boolean {
    this.assertValue(value);
    if (value >= this.capacity) this.grow(value + 1);
    if (this.has(value)) return false;
    let i = value;
    for (const level of this.levels) {
      const w = i >>> 5;
      const wasEmpty = level[w] === 0;
      level[w] = ((level[w] as number) | (1 << (i & 31))) >>> 0;
      if (!wasEmpty) break;
      i = w;
    }
    this.count += 1;
    return true;
  }

  /** Returns true when the value was removed (false when absent). */
  delete(value: number): boolean {
    if (!this.has(value)) return false;
    let i = value;
    for (const level of this.levels) {
      const w = i >>> 5;
      level[w] = ((level[w] as number) & ~(1 << (i & 31))) >>> 0;
      if (level[w] !== 0) break;
      i = w;
    }
    this.count -= 1;
    return true;
  }

  /** Descend from (levelIndex, index) choosing the lowest (or highest) set bit at each level. */
  private descend(levelIndex: number, index: number, lowest: boolean): number {
    let idx = index;
    for (let k = levelIndex - 1; k >= 0; k -= 1) {
      const word = (this.levels[k] as Uint32Array)[idx] as number;
      idx = idx * 32 + (lowest ? ctz(word) : highestBit(word));
    }
    return idx;
  }

  /** Smallest member, or -1 when empty. */
  first(): number {
    if (this.count === 0) return -1;
    return this.next(-1);
  }

  /** Largest member, or -1 when empty. */
  last(): number {
    if (this.count === 0) return -1;
    return this.prev(this.capacity);
  }

  /** Smallest member strictly greater than `value`, or -1. */
  next(value: number): number {
    let j = value + 1;
    if (j < 0) j = 0;
    for (let k = 0; k < this.levels.length; k += 1) {
      const level = this.levels[k] as Uint32Array;
      const w = j >>> 5;
      if (w >= level.length) return -1;
      const masked = (level[w] as number) & (0xffffffff << (j & 31));
      if (masked !== 0) return this.descend(k, w * 32 + ctz(masked), true);
      j = w + 1;
    }
    return -1;
  }

  /** Largest member strictly smaller than `value`, or -1. */
  prev(value: number): number {
    if (value <= 0) return -1;
    let j = Math.min(value - 1, this.capacity - 1);
    for (let k = 0; k < this.levels.length; k += 1) {
      const level = this.levels[k] as Uint32Array;
      const w = j >>> 5;
      const masked = (level[w] as number) & (0xffffffff >>> (31 - (j & 31)));
      if (masked !== 0) return this.descend(k, w * 32 + highestBit(masked), false);
      if (w === 0) return -1;
      j = w - 1;
    }
    return -1;
  }

  *ascending(): IterableIterator<number> {
    for (let v = this.first(); v !== -1; v = this.next(v)) yield v;
  }

  *descending(): IterableIterator<number> {
    for (let v = this.last(); v !== -1; v = this.prev(v)) yield v;
  }

  clone(): OrderedIntSet {
    const copy = new OrderedIntSet(this.capacity);
    copy.levels = this.levels.map((l) => l.slice());
    copy.count = this.count;
    return copy;
  }
}
