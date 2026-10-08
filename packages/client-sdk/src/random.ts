/**
 * Client-side randomness for non-game purposes (action ids, reconnect
 * jitter, the player's fairness client seed). Uses the platform CSPRNG
 * (Web Crypto) — never Math.random.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function cryptoApi(): Crypto {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error('Web Crypto is not available');
  return c;
}

export function randomUint32(): number {
  const buf = new Uint32Array(1);
  cryptoApi().getRandomValues(buf);
  return buf[0]!;
}

/** Uniform float in [0, 1) with 32 bits of entropy (only for jitter). */
export function randomUnit(): number {
  return randomUint32() / 2 ** 32;
}

/** "ACT-" + 20 Crockford base32 chars (100 bits). Matches the server's actionId format. */
export function newActionId(): string {
  const bytes = new Uint8Array(20);
  cryptoApi().getRandomValues(bytes);
  let out = 'ACT-';
  for (const b of bytes) out += CROCKFORD[b & 31];
  return out;
}

/** 32 random bytes as hex — the player's contribution to tournament public entropy. */
export function newClientSeed(): string {
  const bytes = new Uint8Array(32);
  cryptoApi().getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
