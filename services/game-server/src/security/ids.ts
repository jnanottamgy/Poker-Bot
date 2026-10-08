import { randomBytes, randomInt } from 'node:crypto';

/** Crockford base32 alphabet (no I, L, O, U) — unambiguous when read aloud or typed. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBase32(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CROCKFORD[randomInt(CROCKFORD.length)];
  return out;
}

/** Opaque internal id, e.g. "ply_1f3c9a...". 128 bits of CSPRNG entropy. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

/**
 * Public, human-friendly player handle such as "JPN-7A42". Length grows with
 * the field size so collisions stay rare (callers still check uniqueness):
 * at least 4 chars, and enough that 32^len >= 100 x maxPlayers.
 */
export function publicPlayerIdLength(maxPlayers: number): number {
  let len = 4;
  while (32 ** len < maxPlayers * 100) len++;
  return len;
}

export function newPublicPlayerId(maxPlayers: number): string {
  return `JPN-${randomBase32(publicPlayerIdLength(maxPlayers))}`;
}

/** Tournament join code for the QR URL, e.g. "ABC123". */
export function newJoinCode(length = 6): string {
  return randomBase32(length);
}
