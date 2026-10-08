import type { RandomSource } from '../src';

/** A RandomSource that returns the scripted values in order and throws when exhausted. */
export function scriptedSource(values: readonly number[]): RandomSource & { consumed(): number } {
  let i = 0;
  return {
    nextUint32(): number {
      if (i >= values.length) throw new Error('scripted source exhausted');
      const v = values[i] as number;
      i += 1;
      return v;
    },
    consumed: () => i,
  };
}

/** Golden key of the known-answer vectors: bytes 0x00..0x1f. */
export const GOLDEN_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
export const GOLDEN_LABEL = 'JPB/v1/test';

/** Chi-square upper critical value via the Wilson–Hilferty approximation (z = standard-normal quantile). */
export function chiSquareCritical(df: number, z: number): number {
  const a = 2 / (9 * df);
  return df * (1 - a + z * Math.sqrt(a)) ** 3;
}
