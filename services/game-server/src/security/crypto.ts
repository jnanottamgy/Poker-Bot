import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

/**
 * Server-side cryptographic helpers. Everything here uses the platform CSPRNG
 * (`node:crypto`). Never Math.random().
 */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Constant-time comparison of two strings (false on length mismatch without leaking content). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still burn comparable time.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------- passwords (scrypt)

const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, keyLen: 64, saltLen: 16 } as const;

/**
 * scrypt runs on libuv's small thread pool, which Node also uses for DNS
 * lookups and file I/O. Unbounded, a burst of registrations or logins fills
 * the pool and even database connection set-up times out. At most half of the
 * pool hashes at once; the rest queue here.
 */
const KDF_SLOTS = Math.max(1, Math.floor(Number(process.env.UV_THREADPOOL_SIZE ?? 4) / 2));
let kdfActive = 0;
const kdfWaiters: Array<() => void> = [];

async function withKdfSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (kdfActive < KDF_SLOTS) kdfActive++;
  else await new Promise<void>((resolve) => kdfWaiters.push(resolve));
  try {
    return await fn();
  } finally {
    // Hand the slot straight to the next waiter (no window where both proceed).
    const next = kdfWaiters.shift();
    if (next) next();
    else kdfActive--;
  }
}

function scrypt(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return withKdfSlot(
    () =>
      new Promise((resolve, reject) => {
        scryptCb(password, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)));
      }),
  );
}

/** Format: scrypt$N$r$p$saltB64url$hashB64url */
export async function hashPassword(password: string, cost: { N?: number } = {}): Promise<string> {
  const salt = randomBytes(SCRYPT_PARAMS.saltLen);
  const { r, p, keyLen } = SCRYPT_PARAMS;
  const N = cost.N ?? SCRYPT_PARAMS.N;
  const key = await scrypt(password, salt, keyLen, { N, r, p, maxmem: 128 * N * r * 2 });
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltStr, hashStr] = parts as [string, string, string, string, string, string];
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![N, r, p].every((v) => Number.isSafeInteger(v) && v > 0)) return false;
  const expected = Buffer.from(hashStr, 'base64url');
  const key = await scrypt(password, Buffer.from(saltStr, 'base64url'), expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// ---------------------------------------------------------------- secret box (AES-256-GCM)

const SECRET_BOX_VERSION = 'v1';

export function parseEncryptionKey(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Encryption key must be 64 hex characters (32 bytes)');
  return Buffer.from(hex, 'hex');
}

/** Encrypts a UTF-8 secret. Output: v1.<iv>.<tag>.<ciphertext> (base64url parts). */
export function encryptSecret(plaintext: string, key: Buffer, associatedData = ''): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SECRET_BOX_VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(box: string, key: Buffer, associatedData = ''): string {
  const parts = box.split('.');
  if (parts.length !== 4 || parts[0] !== SECRET_BOX_VERSION) throw new Error('Unsupported secret box format');
  const [, ivStr, tagStr, ctStr] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivStr, 'base64url'));
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagStr, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctStr, 'base64url')), decipher.final()]).toString('utf8');
}
