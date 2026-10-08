import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from '../security/crypto';

/**
 * Rejoin codes let a player recover their seat on another device (spec §8,
 * §9). 8 Crockford base32 characters (40 bits) shown as XXXX-XXXX; stored as
 * a scrypt hash; guessing is throttled by per-player and per-IP rate limits.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newRejoinCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Accepts lowercase, missing dash, and the confusable letters O/I/L typed for 0/1/1. */
export function normalizeRejoinCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export const hashRejoinCode = (code: string) => hashPassword(code);
export const verifyRejoinCode = (code: string, hash: string) => verifyPassword(code, hash);
