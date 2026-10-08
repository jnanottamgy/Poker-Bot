/**
 * Staff-issued rejoin QR codes open `/join/<code>#rejoin=JPN-7A42:7KQM-2XWD`.
 * The fragment never reaches the server logs; the app reads it once and then
 * removes it from the address bar.
 */
export interface RejoinCredentials {
  publicId: string;
  rejoinCode: string;
}

const PUBLIC_ID = /^[A-Z]{2,5}-[A-Z0-9]{3,10}$/;
const REJOIN_CODE = /^[A-Z0-9]{3,16}(-[A-Z0-9]{3,16}){0,3}$/;

export function normalizePublicId(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  // "JPN7A42" → "JPN-7A42"
  const m = /^([A-Z]{3})([A-Z0-9]{3,10})$/.exec(s);
  return m ? `${m[1]}-${m[2]}` : s;
}

export function normalizeRejoinCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidPublicId(s: string): boolean {
  return PUBLIC_ID.test(s);
}

export function isValidRejoinCode(s: string): boolean {
  return REJOIN_CODE.test(s);
}

/** Parses `#rejoin=PUBLICID:CODE`. Returns null for anything else or malformed values. */
export function parseRejoinFragment(hash: string): RejoinCredentials | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const value = new URLSearchParams(raw).get('rejoin');
  if (!value) return null;
  const sep = value.indexOf(':');
  if (sep <= 0) return null;
  const publicId = normalizePublicId(value.slice(0, sep));
  const rejoinCode = normalizeRejoinCode(value.slice(sep + 1));
  if (!isValidPublicId(publicId) || !isValidRejoinCode(rejoinCode)) return null;
  return { publicId, rejoinCode };
}
