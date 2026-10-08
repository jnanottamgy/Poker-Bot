/**
 * Persistent, plain-JSON map for very large keyed collections (players,
 * tables). A pure reducer must not copy a 1,000,000-entry object on every
 * input, so entries live in BUCKET_COUNT buckets chosen by a deterministic
 * FNV-1a hash of the key: an update copies one bucket (~N/1024 entries) and the
 * bucket directory (1024 keys). Same content ⇒ same layout on every node.
 */
export const BUCKET_COUNT = 1024;

export interface BucketMap<V> {
  size: number;
  buckets: Record<string, Record<string, V>>;
}

export function emptyBucketMap<V>(): BucketMap<V> {
  return { size: 0, buckets: {} };
}

/** FNV-1a (32-bit) over UTF-16 code units, reduced to a bucket id. */
export function bucketOf(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % BUCKET_COUNT).toString(36);
}

export function bmGet<V>(m: BucketMap<V>, key: string): V | undefined {
  return m.buckets[bucketOf(key)]?.[key];
}

export function bmHas<V>(m: BucketMap<V>, key: string): boolean {
  return bmGet(m, key) !== undefined;
}

/** Returns a new map with all `entries` set (one copy per touched bucket). */
export function bmSetMany<V>(m: BucketMap<V>, entries: ReadonlyArray<readonly [string, V]>): BucketMap<V> {
  if (entries.length === 0) return m;
  const buckets = { ...m.buckets };
  const copied = new Set<string>();
  let size = m.size;
  for (const [key, value] of entries) {
    const b = bucketOf(key);
    if (!copied.has(b)) {
      buckets[b] = { ...(buckets[b] ?? {}) };
      copied.add(b);
    }
    const bucket = buckets[b]!;
    if (!(key in bucket)) size += 1;
    bucket[key] = value;
  }
  return { size, buckets };
}

export function bmSet<V>(m: BucketMap<V>, key: string, value: V): BucketMap<V> {
  return bmSetMany(m, [[key, value]]);
}

export function bmDelete<V>(m: BucketMap<V>, key: string): BucketMap<V> {
  const b = bucketOf(key);
  const bucket = m.buckets[b];
  if (!bucket || !(key in bucket)) return m;
  const next = { ...bucket };
  delete next[key];
  return { size: m.size - 1, buckets: { ...m.buckets, [b]: next } };
}

/** All values in a deterministic order (bucket id, then key). O(N) — only for rare, global operations. */
export function bmValues<V>(m: BucketMap<V>): V[] {
  const out: V[] = [];
  for (const b of Object.keys(m.buckets).sort()) {
    const bucket = m.buckets[b]!;
    for (const k of Object.keys(bucket).sort()) out.push(bucket[k]!);
  }
  return out;
}
