/**
 * Deterministic pseudo-random numbers for the MOCK backend only (fixtures and
 * scripted bot decisions). Never used for anything a real game depends on:
 * the real server deals with @jpb/randomness.
 */
export type Rng = () => number;

/** mulberry32: tiny, fast, good enough for fixtures. Returns floats in [0, 1). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a), to derive seeds from labels. */
export function hashSeed(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick from empty list');
  return item;
}

export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Deterministic Crockford base32 string. */
export function code(rng: Rng, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += CROCKFORD[Math.floor(rng() * 32)];
  return s;
}

export function hex(rng: Rng, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += Math.floor(rng() * 16).toString(16);
  return s;
}
