/**
 * A source of uniformly distributed unsigned 32-bit integers.
 *
 * Every random decision in the system (shuffles, seat draws, button draws)
 * consumes values from a RandomSource that is *injected* — either the platform
 * CSPRNG (`secureRandomSource` in `@jpb/randomness/node`) or the deterministic,
 * verifiable `HmacDrbgSource`.
 */
export interface RandomSource {
  /** An integer in [0, 2^32), uniformly distributed. */
  nextUint32(): number;
}

/**
 * An HMAC-SHA256 implementation: returns the 32-byte MAC of `message` under
 * `key`. The portable default is the pure-JS `hmacSha256`; Node callers may
 * pass the much faster `nodeHmacSha256` from `@jpb/randomness/node`. Every
 * implementation must produce identical bytes (tested).
 */
export type HmacSha256Fn = (key: Uint8Array, message: Uint8Array) => Uint8Array;
