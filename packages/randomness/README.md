# @jpb/randomness

Cryptographic randomness for Johnny's Poker Bot: the platform CSPRNG for
secrets, and a deterministic, verifiable HMAC-SHA256 stream for everything that
must be reproducible (shuffles, seat and button draws). No AI, no `Math.random()`.

Two entry points:

| Entry | Environments | Contents |
| --- | --- | --- |
| `@jpb/randomness` (`src/index.ts`) | browser + Node (no `node:` imports) | pure-JS SHA-256 / HMAC-SHA256, hex/UTF-8 helpers, `HmacDrbgSource`, `uniformInt`, `fisherYatesShuffle` |
| `@jpb/randomness/node` (`src/node.ts`) | Node only | everything above **plus** `secureRandomSource`, `secureRandomBytes`, `secureRandomInt`, `generateSeedHex`, `nodeHmacSha256`, `nodeSha256(Hex)`, `createNodeHmacDrbg` |

The public fairness verifier runs in browsers, so the portable entry carries
its own SHA-256: WebCrypto's digest/HMAC are asynchronous and do not fit the
synchronous `RandomSource` interface.

## Modules

| File | Purpose |
| --- | --- |
| `types.ts` | `RandomSource { nextUint32(): number }`, `HmacSha256Fn` |
| `bytes.ts` | `bytesToHex` (lowercase), `hexToBytes` (strict), `isHex`, `isLowerHex`, strict `utf8Encode`, `isWellFormedString`, `toBytes`, `concatBytes` |
| `sha256.ts` | FIPS 180-4 SHA-256 (`Sha256` incremental, `sha256`, `sha256Hex`), RFC 2104 HMAC (`hmacSha256`, keyed `createHmacSha256`) |
| `drbg.ts` | normative HMAC-SHA256 counter-mode stream: `HmacDrbgSource`, `createHmacDrbg`, `streamBlock`, `streamBlockMessage` |
| `uniform.ts` | `uniformInt` (normative rejection sampling) |
| `shuffle.ts` | `fisherYatesShuffle` (normative Durstenfeld) |
| `node.ts` | CSPRNG + native HMAC/SHA-256 |

## Algorithms (normative — CONTRACTS §1)

### HMAC-SHA256 counter-mode stream

```
key      = raw key bytes (non-empty; e.g. the 32-byte server seed)
label    = UTF-8 string (domain separation, see @jpb/fairness-engine)
block(i) = HMAC-SHA256(key, UTF-8(label) || "|" || ASCII(decimal(i)))      i = 0, 1, 2, ...
stream   = block(0) || block(1) || block(2) || ...
nextUint32() = next 4 unread stream bytes, big-endian
```

`decimal(i)` is base 10 with no sign, padding or leading zeros. `nextBytes(n)`
reads the same contiguous stream, so mixing it with `nextUint32()` is
well-defined (a word may then straddle two blocks). The key is copied at
construction. An optional third constructor argument supplies a faster
HMAC-SHA256 (e.g. `nodeHmacSha256`); every block it returns is checked to be
32 bytes and copied, so an implementation that reuses buffers cannot corrupt
the stream.

### Unbiased integers

```
uniformInt(src, n):  require 1 <= n <= 2^32 (safe integer)
  limit = floor(2^32 / n) * n
  repeat u = src.nextUint32() until u < limit
  return u mod n
```

Exactly one value is consumed per attempt, including for `n = 1` (always 0)
and powers of two (never reject). Values in the biased tail `[limit, 2^32)`
are rejected, so every result in `[0, n)` has probability exactly `1/n`.

### Shuffle

Durstenfeld Fisher–Yates on a copy: `for i = n-1 down to 1: j = uniformInt(i+1); swap(a[i], a[j])`.
The input is never mutated; arrays of length 0 or 1 consume no randomness.

### SHA-256 / HMAC-SHA256

Straight FIPS 180-4 (64 rounds, big-endian words, `0x80` padding with the
64-bit bit length) and RFC 2104 (keys longer than 64 bytes are hashed first,
then zero-padded to 64 bytes; `ipad = 0x36`, `opad = 0x5c`).
`createHmacSha256(key)` absorbs the two pad blocks once and clones the
midstates per message, which is what makes the pure-JS DRBG fast enough for
bulk verification in a browser (~2 compressions per 32-byte block for short
labels).

### CSPRNG (`/node`)

- `secureRandomSource()` — each instance pools 4096 bytes from
  `crypto.randomBytes` and serves them as big-endian uint32s; consumed bytes
  are zeroed. No module-level state.
- `secureRandomBytes(n)` — fresh `Uint8Array` from `crypto.randomBytes` (`0 <= n < 2^31`).
- `secureRandomInt(max)` — `crypto.randomInt(max)` (`1 <= max <= 2^48 - 1`).
- `generateSeedHex(bytes = 32)` — lowercase hex of `bytes` CSPRNG bytes (`1..1024`).

## Known-answer vectors

Computed once with `node:crypto` from the formula (independently of this
package) and asserted in `test/drbg.test.ts`, `test/uniform.test.ts`,
`test/shuffle.test.ts`. Key = bytes `00 01 … 1f`, label `JPB/v1/test`:

```
block(0) = 30bfe8d7f155d9ab664dab9bc23042572c0eb184482b023c3fff4e847ac1c1cc
block(1) = 5399f1ce1df979bfc26336f06867e1414578aac2259fd16020b61a966b2f366d
nextUint32 × 4 = 817883351, 4048935339, 1716366235, 3257942615
fisherYatesShuffle([0..9]) = [5, 7, 9, 0, 2, 6, 4, 8, 3, 1]
```

More (UTF-8 labels, multi-digit counters, empty label) in `docs/FAIRNESS.md` §5.

## Tests

- SHA-256: NIST vectors (empty, `abc`, 448-bit, 896-bit, one million `a` in one
  shot and in uneven chunks), every length 0..300 and random inputs vs
  `node:crypto`, random split points, UTF-8 strings.
- HMAC-SHA256: RFC 4231 test cases 1–7 (pure JS, keyed, node), random keys
  (including > block size) and messages vs `node:crypto`.
- Stream: known answers for both implementations, the formula on random
  keys/labels/lengths, mixed `nextBytes`/`nextUint32` reads, key copying,
  label/key separation, broken-HMAC detection.
- `uniformInt`: scripted sources returning values in the biased tail (proves
  rejection and one-value-per-attempt), boundaries (`limit - 1` accepted),
  `n = 1`, powers of two, `n = 2^32`, invalid `n`, invalid source values,
  stuck sources, properties.
- Shuffle: known answers, exact Durstenfeld order, permutation property,
  determinism, label/key separation, chi-square uniformity of every card over
  every position (20,800 seeded shuffles) and of all 24 permutations of 4
  items (24,000 seeded shuffles) — seeded, so deterministic, never flaky.
- `/node`: CSPRNG ranges, refills, bit balance, `secureRandomInt` uniformity,
  seed format, performance sanity (10,000 52-card shuffles with the native
  HMAC; 2,000 with the pure-JS HMAC).

## Contract notes

Clarifications of / deviations from `docs/CONTRACTS.md` §1:

1. **Entry split.** `secureRandomSource`, `secureRandomBytes`, `secureRandomInt`
   and `generateSeedHex` are exported from `@jpb/randomness/node`, not from the
   main entry, which must stay importable in browsers. The `/node` entry
   re-exports the whole portable API, so server code can import everything
   from it.
2. **Strict UTF-8.** `sha256Hex`, `hmacSha256` and stream labels encode
   strings with a strict UTF-8 encoder that throws `RangeError` on unpaired
   surrogates (TextEncoder/Buffer would silently substitute U+FFFD, letting
   two different strings hash identically).
3. **`hexToBytes`** accepts either case and throws on odd length or non-hex
   characters; `bytesToHex` always emits lowercase.
4. **`HmacDrbgSource(key, label, hmac?)`** takes an optional faster HMAC
   implementation, rejects empty keys and copies the key. Extra members:
   `nextBytes(n)`, `blocksGenerated`, `bytesConsumed`, `label`.
5. **`uniformInt`** throws `RangeError` for `n` outside `[1, 2^32]` or not a
   safe integer, and for a source that returns anything other than an integer
   in `[0, 2^32)`. As a safety valve (not part of the normative algorithm) it
   throws after 1024 consecutive rejections: a functioning source reaches this
   with probability < 2^-1024, so outputs are identical to the normative
   "repeat until" whenever it returns.
6. **`secureRandomInt`** is limited to `maxExclusive <= 2^48 - 1` (the
   `crypto.randomInt` bound).
7. Additional exports: `Sha256`, `sha256`, `createHmacSha256`,
   `SHA256_BYTES`, `SHA256_BLOCK_BYTES`, `streamBlock`, `streamBlockMessage`,
   `createHmacDrbg`, `UINT32_RANGE`, `MAX_CONSECUTIVE_REJECTIONS`, the byte
   helpers, and on `/node`: `nodeHmacSha256`, `nodeSha256`, `nodeSha256Hex`,
   `createNodeHmacDrbg` and the size constants.
