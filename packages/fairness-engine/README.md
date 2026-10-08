# @jpb/fairness-engine

Commit–reveal of the server seed, deterministic per-hand deck derivation,
seat/button draw streams, and **independent verification** of dealt hands.
No AI: SHA-256, HMAC-SHA256, rejection sampling and Fisher–Yates only.

The full story — guarantees, honest limitations, byte-level formulas, test
vectors and a standalone verification script — is in
[`docs/FAIRNESS.md`](../../docs/FAIRNESS.md). This README documents the API and
the exact rules the code enforces.

| Entry | Environments | Use |
| --- | --- | --- |
| `@jpb/fairness-engine` (`src/index.ts`) | browser + Node | derivation and verification (admin dashboard, public verify page) |
| `@jpb/fairness-engine/node` (`src/node.ts`) | Node only | everything above, plus `createSeedCommitment` (CSPRNG); `deriveDeck`, `createDeckProvider`, `drawSource`, `verifyHand`, `verifyBundle` default to the node:crypto HMAC (byte-identical, faster) |

## Modules

| File | Purpose |
| --- | --- |
| `constants.ts` | label prefix `JPB/v1/`, separators, reserved purposes, sizes, dealing constants |
| `validate.ts` | input rules shared by derivation (throws) and verification (reports) |
| `commitment.ts` | `commitmentFor`, `isValidServerSeed`, `seedMatchesCommitment` |
| `entropy.ts` | `computePublicEntropy`, `publicEntropyPreimage`, `clientSeedProblem` |
| `labels.ts` | `deckLabel`, `drawLabel`, `deckLabelProblem` |
| `deck.ts` | `deriveDeck`, `createDeckProvider`, `drawSource`, `deckHash`, `isCardCode`, `isFullDeck` |
| `dealing.ts` | the normative dealing order: `dealingOrder`, `dealPositions`, `expectedDeal`, `cardsNeeded` |
| `record.ts` | `recordShapeProblems`, `isHandFairnessRecord`, `redactHandFairnessRecord` |
| `verify.ts` | `verifyHand` |
| `bundle.ts` | `buildVerificationBundle`, `verifyBundle`, `bundleShapeProblems`, `FAIRNESS_METHOD` |
| `node.ts` | `createSeedCommitment` and node-accelerated defaults |
| `examples/` | dependency-free verifiers (node:crypto, WebCrypto) embedded in docs/FAIRNESS.md and tested against the engine |

Types (`HandFairnessRecord`, `HandVerificationResult`, `FairnessExport`, …)
live in `@jpb/shared-types` (`fairness.ts`) so that the table engine can
produce records without depending on this package; they are re-exported here.

## Constructions (normative — CONTRACTS §2)

```
serverSeed      = 32 CSPRNG bytes, hex                      createSeedCommitment()  (/node)
serverSeedHash  = hex(SHA-256(serverSeedBytes))             commitmentFor(seed)
publicEntropy   = hex(SHA-256(UTF-8("JPB/v1/entropy|" + sort(clientSeeds).join(",") + "|" + (adminEntropy ?? ""))))
deck label      = "JPB/v1/deck|{tournamentId}|{tableId}|{handNumber}|{publicEntropy}"
draw label      = "JPB/v1/{purpose}|{tournamentId}|{publicEntropy}"
deck            = fisherYatesShuffle(CANONICAL_DECK, HmacDrbgSource(serverSeedBytes, deck label))   deck[0] = top
drawSource      = HmacDrbgSource(serverSeedBytes, draw label)
deckHash        = hex(SHA-256(ASCII(deck.join(""))))
```

The stream, `uniformInt` and the shuffle are defined in `@jpb/randomness`.

### Dealing order (shared with `@jpb/poker-engine`)

With the `N` dealt-in seats ordered clockwise (ascending index, wrapping at
`maxSeats`) starting with the first seat **after** the button (the button
seat may be empty; if occupied it is dealt last):

```
hole card 1 of the k-th seat = deck[k]          k = 0..N-1
hole card 2 of the k-th seat = deck[N + k]
burn 1 = deck[2N],   flop  = deck[2N+1 .. 2N+3]
burn 2 = deck[2N+4], turn  = deck[2N+5]
burn 3 = deck[2N+6], river = deck[2N+7]
```

`dealingOrder(seats, buttonSeat, maxSeats)` computes the order;
`expectedDeal(deck, seatsInDealingOrder)` returns every seat's hole cards, the
three burn positions and the five board positions. `test/dealing.test.ts`
cross-checks this against the poker engine's `dealFromDeck` on random tables
(loaded dynamically; skipped only if that package is absent).

## Input rules

Derivation functions throw `RangeError` on invalid input (programmer error):

- `serverSeed`: exactly 32 bytes of hex, either case (the bytes are the key).
- `tournamentId`, `tableId`, `purpose`: non-empty, no `|`, no unpaired
  surrogates — so distinct inputs always give distinct labels.
- `handNumber`: non-negative safe integer, written in decimal.
- `publicEntropy`: exactly 64 **lowercase** hex characters (it is used
  verbatim inside labels, so a differently-cased value would silently give a
  different deck).
- `purpose`: `deck` and `entropy` are reserved.
- client seeds: 1..256 printable ASCII characters (0x21–0x7E) other than `,`
  and `|`; sorted by character code (= byte order for ASCII); duplicates kept.
  `adminEntropy`: any well-formed string or null (null ≡ "").
- `deckHash` hashes only full 52-card permutations.

## Verification

`verifyHand(record, revealedServerSeed | null, { hmac? })` never throws and
returns `HandVerificationResult`:

| Check | Rule |
| --- | --- |
| `SEED_COMMITMENT` | `SHA-256(seed bytes) == record.serverSeedHash` (hex case-insensitive). Seed null → NOT_AVAILABLE; invalid seed or digest → FAILED. When not VERIFIED, the other three checks are NOT_AVAILABLE and `derived` is null. |
| `DECK_HASH` | `deckHash(deriveDeck(seed, record ids, publicEntropy)) == record.deckHash`. Label inputs unusable → FAILED (others NOT_AVAILABLE). |
| `HOLE_CARDS` | Seat list valid (`maxSeats` 2..10, button in range, 2..maxSeats distinct in-range seats, distinct non-empty playerIds) else FAILED. Each seat with published cards must match `[deck[k], deck[N+k]]` for its dealing position k (cards matched by seat; listing order irrelevant; the two cards in dealing order). Withheld seats (`cards: null`) are listed in `withheldSeats`; all withheld → NOT_AVAILABLE. |
| `BOARD` | Board length 0/3/4/5 and, if published, `burns.length` 0/1/2/3 accordingly, else FAILED. Each published board/burn card must equal its position. An empty board is VERIFIED with the explicit detail that no community cards were dealt. Burns `null` → not checked (stated in the detail). Invalid seat list → FAILED (positions depend on N). |

Overall `status`: VERIFIED iff all four VERIFIED; FAILED iff any FAILED;
otherwise INCOMPLETE. Mismatches list `{ item, published, derived }`
(e.g. `seat 0 hole card 2`, `turn`, `burn 1 (before the flop)`, `deck hash`).
A structurally malformed record fails all four checks; an unknown `scheme`
makes all four NOT_AVAILABLE. `derived` exposes the label, deck, deck hash and
(when the seat list is valid) the full expected deal.

`buildVerificationBundle({ tournamentId, serverSeedHash, serverSeed | null,
publicEntropy, entropyInputs | null, hands })` returns a `FairnessExport`
(format `JPB-FAIRNESS-EXPORT` v1, with `FAIRNESS_METHOD` describing every
construction). It deep-copies, sorts hands by `(tableId, handNumber)`, and
throws if the revealed seed does not match the commitment, the entropy inputs
do not hash to `publicEntropy`, a hand belongs to another tournament /
commitment / entropy, or a hand is duplicated.

`verifyBundle(unknown, { serverSeed?, hmac? })` never throws. Checks:
`FORMAT` (structure; on failure nothing else runs), `SEED_COMMITMENT`,
`PUBLIC_ENTROPY` (NOT_AVAILABLE without inputs), `HAND_CONSISTENCY`
(NOT_AVAILABLE with zero hands), then `verifyHand` per hand with the bundle's
seed or the `serverSeed` option (e.g. pasted by a user). Overall VERIFIED only
if every bundle check and every hand is VERIFIED. At most 50 problems are
listed per check.

`redactHandFairnessRecord(record, { revealSeats: 'ALL' | 'NONE' | seats[], includeBurns })`
produces public / per-player views: withheld cards become null, the seat
list stays (board positions depend on it).

## Trust assumptions and limitations

Verification proves that the **published** cards of a hand came from the deck
committed before registration (given SHA-256/HMAC-SHA256 security and that you
compare against the hash that was really published beforehand). It does
**not** prove (details in docs/FAIRNESS.md §3):

- that the operator did not grind the public entropy before START (it sees all
  client seeds, controls admin entropy and could register fake players) —
  mitigate with a pre-announced public beacon as admin entropy;
- anything about fake registrations, multi-accounting or player collusion;
- that nobody with privileged access (operator, `VIEW_HOLE_CARDS` staff, holder
  of the database and seed key) leaked live or future cards — the server knows
  all of them;
- that the deployed server runs this code, beyond the published cards matching;
- anything about withheld cards (mucked hands, withheld burns): such hands are
  INCOMPLETE, never VERIFIED;
- that the records equal what players saw — each player should verify their own hand;
- seat/button draws, betting, pots or payouts.

We therefore call deals **verifiable**, not "provably fair".

## Integration (for the runtime)

```ts
import { createSeedCommitment, computePublicEntropy, createDeckProvider, drawSource } from '@jpb/fairness-engine/node';

const { serverSeed, serverSeedHash } = createSeedCommitment();          // tournament creation; publish the hash
const publicEntropy = computePublicEntropy({ clientSeeds, adminEntropy }); // once, at START; write-once
const deckFor = createDeckProvider({ serverSeed, tournamentId, tableId, publicEntropy }); // TableContext.deckFor
const seatingRng = drawSource({ serverSeed, tournamentId, purpose: 'seating', publicEntropy });
```

`HandFairnessRecord`s must be built from what the poker engine actually dealt
(events), never by re-deriving the deck, or verification would be circular.

## Tests

- Golden hand (seed, commitment, entropy, label, deck, deck hash, hole cards,
  burns, board, seating stream) computed independently with node:crypto.
- Commitment over seed bytes, case handling, invalid seeds; entropy order
  independence, duplicates, null ≡ "", Unicode admin entropy, client-seed
  rules, no separator ambiguity (property).
- Labels: validation, injectivity (property); decks: permutation,
  determinism, pure JS ≡ node:crypto (property), sensitivity to every input.
- Dealing order: examples (dead button, heads-up, wrap-around), clockwise-walk
  property, normative positions for N = 1..22, cross-check with the poker engine.
- Verification: honest random hands always VERIFIED (property, all streets,
  dead buttons, 2..10 seats); every tamper class fails the right check —
  commitment, deck hash, a hole card, swapped seats, reversed hole cards,
  river, flop order, burn, board size, burns count, button, dropped seat,
  entropy, hand number, table id; any single changed card in a random hand
  fails exactly the right check (property); seeds missing / wrong / malformed;
  withheld cards and burns; malformed records and seat lists never throw.
- Bundles: build/verify through JSON, sorting, deep copy, refusals,
  pre-reveal and user-supplied seeds, missing inputs, redaction, bundle-level
  and per-hand tampering, duplicates, malformed input, problem caps.
- `/node`: `createSeedCommitment`, full re-export, node ≡ portable results,
  bulk verification speed (2,000 hands).
- Standalone examples: golden vector, agreement with the engine on random and
  tampered inputs, and docs/FAIRNESS.md embeds the node script verbatim.
- Portability: no Node-only code reachable from the main entry.

## Contract notes

Clarifications of / additions to `docs/CONTRACTS.md` §2:

1. **Entry split.** `createSeedCommitment` is only in `@jpb/fairness-engine/node`
   (it needs the CSPRNG). The main entry is portable. `/node` re-exports
   everything and shadows `deriveDeck`, `createDeckProvider`, `drawSource`,
   `verifyHand`, `verifyBundle` with node:crypto-HMAC defaults.
2. **Optional HMAC.** `deriveDeck(p, hmac?)`, `drawSource(p, hmac?)`,
   `createDeckProvider(p, hmac?)`, `verifyHand(record, seed, { hmac })`,
   `verifyBundle(bundle, { hmac, serverSeed })`.
3. **Validation rules** listed under *Input rules* above (ids without `|`,
   lowercase entropy, 32-byte seeds, client-seed alphabet, reserved purposes).
   The contract did not define the client-seed alphabet or the sort order;
   these rules make the entropy preimage unambiguous in every language.
4. **`HandFairnessRecord`** (in shared-types) adds `scheme: 'JPB/v1'`,
   `maxSeats` and `buttonSeat` (needed to recompute the dealing order),
   `playerId` per seat, nullable per-seat `cards` (withheld private cards) and
   nullable `burns`. Board: 0, 3, 4 or 5 cards.
5. **`verifyHand(record, seed | null)`**: a null seed is allowed (not yet
   revealed). Overall status is VERIFIED / FAILED / INCOMPLETE. A failed
   commitment makes the other checks NOT_AVAILABLE rather than reporting
   checks against an uncommitted seed. `handId` is informational (not part of
   the deck derivation); duplicates are caught at bundle level.
6. **Bundle API** (`buildVerificationBundle(input)`, `verifyBundle(unknown, opts)`)
   and the `FairnessExport` format are defined here; the contract left them
   open (`buildVerificationBundle(...)`).
7. **Not verified by this package:** seat and button draws (they need the
   seating/balancing algorithms), betting and pot distribution, and anything
   about who registered or what was shown on screens — see docs/FAIRNESS.md §3.
8. Additional exports: `createDeckProvider`, `dealingOrder`, `dealPositions`,
   `expectedDeal`, `cardsNeeded`, `publicEntropyPreimage`,
   `seedMatchesCommitment`, `redactHandFairnessRecord`, shape validators and
   the constants.
