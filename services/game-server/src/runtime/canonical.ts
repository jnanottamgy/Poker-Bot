/**
 * Canonical deep copy of a JSON value: every object's keys are re-inserted in
 * sorted order. Commands are logged as JSONB, which reorders object keys
 * (shorter keys first, then bytewise). The host canonicalizes a command before
 * `step` and recovery canonicalizes it again after reading it back, so `step`
 * sees the same key order live and on replay whatever the storage does.
 *
 * Throws TypeError for values that are not JSON-serializable.
 */
export function canonicalCopy<T>(value: T): T {
  const text = JSON.stringify(value) as string | undefined;
  if (text === undefined) throw new TypeError('value is not JSON-serializable');
  return JSON.parse(text, sortKeys) as T;
}

/** JSON.parse reviver: runs bottom-up, so nested objects are already sorted. */
function sortKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    // defineProperty: a "__proto__" key from untrusted JSON stays a plain own property.
    Object.defineProperty(out, key, { value: source[key], enumerable: true, writable: true, configurable: true });
  }
  return out;
}
