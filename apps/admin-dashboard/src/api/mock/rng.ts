/**
 * Deterministic pseudo-randomness for MOCK DATA ONLY (never game logic):
 * mulberry32 seeded from a string hash, so the same seed always produces the
 * same 2,000 players, hands and audit entries.
 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 64 lowercase hex chars derived from `s` (looks like a SHA-256; it is not one). */
export function fakeHash(s: string): string {
  let out = '';
  let h = hashString(s);
  for (let i = 0; i < 8; i++) {
    h = hashString(`${h}:${i}:${s.length}`);
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  /** Roughly normal (mean 0, sd 1) via the sum of uniforms. */
  gauss(): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return (s - 3) / Math.sqrt(0.5);
  }

  hex(len: number): string {
    let out = '';
    while (out.length < len) out += Math.floor(this.next() * 0x100000000).toString(16).padStart(8, '0');
    return out.slice(0, len);
  }

  /** Crockford-ish upper-case id, e.g. for public ids "JPN-7A42". */
  code(len: number): string {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let out = '';
    for (let i = 0; i < len; i++) out += alphabet[Math.floor(this.next() * alphabet.length)];
    return out;
  }
}
