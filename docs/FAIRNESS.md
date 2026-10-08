# Fairness: commit–reveal and independent verification

Johnny's Poker Bot deals every card from a deck that anyone can recompute
after the tournament. There is **no AI** anywhere in this path (see
[NO_AI.md](./NO_AI.md)): the platform CSPRNG, SHA-256, HMAC-SHA256, rejection
sampling and a Fisher–Yates shuffle do all the work.

This document explains:

1. how commit–reveal works here, step by step;
2. **exactly** what it guarantees and, just as important, what it does **not**;
3. the byte-level formulas, so an auditor can re-implement them in any language;
4. known-answer vectors;
5. how a third party verifies a hand, with a short standalone script.

The implementation lives in `@jpb/randomness` (stream, integers, shuffle) and
`@jpb/fairness-engine` (commitments, entropy, decks, verification). Their
READMEs cover the APIs; `docs/CONTRACTS.md` §1–2 is the normative contract.

We describe the deals as **verifiable**. We do not use "provably fair" for
anything the verifier cannot recompute on its own (see §3).

---

## 1. Commit–reveal in one picture

| When | What happens | Who learns what |
| --- | --- | --- |
| Tournament created | The server draws a 32-byte **server seed** from the OS CSPRNG (`node:crypto`) and stores it encrypted (AES-256-GCM). | Nobody outside the server learns the seed. |
| Before registration opens | The **commitment** `serverSeedHash = SHA-256(seed bytes)` is published (join page, public fairness page, every player summary). | Everyone sees the hash. Because SHA-256 is preimage- and collision-resistant, the operator can no longer switch to a different seed. |
| Registration | Each player's browser generates a random **client seed** (32 bytes from WebCrypto) and sends it with the registration. | The server sees every client seed. |
| START | The director freezes **public entropy** = SHA-256 of all client seeds (sorted) plus optional admin entropy, stores it once (it can never change) and publishes it with its inputs. | Everyone sees the entropy and its inputs. Each player can check that their own client seed is in the list. |
| Every hand | Deck = Fisher–Yates shuffle of the canonical deck, driven by an HMAC-SHA256 stream keyed with the server seed and labelled with tournament id, table id, hand number and public entropy. The server records the deck hash, the hole cards per seat, the board and the burn cards. | Players see only their own cards and the public board. |
| COMPLETED / CANCELLED | An authorised director reveals the seed (`FAIRNESS_REVEAL_SEED`, double confirmation, audit-logged). | Everyone can now recompute every deck and check every published card. |

---

## 2. What is guaranteed

Assumptions: SHA-256 is preimage- and collision-resistant, HMAC-SHA256 is a
pseudorandom function, and the commitment you compare against is the one that
was really published before registration opened (you must check that
yourself — see step 1 of §6).

- **G1 — The seed is fixed in advance.** After the commitment is published, the
  operator cannot use a different seed without the reveal failing the
  `SEED_COMMITMENT` check.
- **G2 — Every deck is fixed at START, before any card is dealt.** A hand's deck
  is a pure function of (server seed, public entropy, tournament id, table id,
  hand number). Nothing that happens during play — actions, hole cards, stacks,
  who is winning, which admin is watching — is an input. The server cannot
  "adapt" the cards to the game in progress without detection.
- **G3 — Deviations in published cards are detected.** If any published hole
  card, board card or burn card differs from its position in the derived deck,
  or the published deck hash differs from the derived deck's hash, the
  corresponding check reports **FAILED**.
- **G4 — The shuffle is unbiased.** Integers are drawn by rejection sampling
  (no modulo bias) and the Durstenfeld Fisher–Yates shuffle makes all 52!
  orders equally likely given a uniform stream. Tests include chi-square
  checks of card positions and of full permutations.
- **G5 — Players cannot predict cards.** Without the seed, the HMAC stream is
  unpredictable even to someone who knows every other input.
- **G6 — Verification needs no trust in our code.** The formulas in §4 are
  complete; the standalone script in §6 uses only `node:crypto`, and any
  language with SHA-256 and HMAC-SHA256 can reproduce the decks byte for byte.

---

## 3. What is NOT guaranteed (read this)

Commit–reveal protects the **integrity of the deal**. It does not make the
operator trustworthy in every other respect. Known limits:

- **N1 — Entropy grinding by the operator.** The operator knows the seed, sees
  every client seed before START, chooses the optional admin entropy, and could
  register fake players with chosen client seeds. It can therefore try many
  candidate entropy values before START and pick one whose decks (and initial
  seat draw) it likes — for example strong early cards for an accomplice's
  seat. Client seeds only stop an operator who does *not* control the last
  contribution. *Mitigation:* use as admin entropy a public randomness-beacon
  value that is fixed only after registration closes and named in advance
  (e.g. "the drand round at 19:00" or a pre-announced future block hash), and
  publish the entropy inputs at START. The verifier cannot check where the
  admin entropy came from; you have to check the announcement.
- **N2 — Fake registrations and collusion.** The deal being fair says nothing
  about *who* is playing: sock-puppet entries, multi-accounting, chip dumping
  and soft play are outside this mechanism (they are policed by registration
  approval, staff and hand-history review).
- **N3 — Live information leaks.** The server holds every live hole card and,
  because it holds the seed, can compute every future card of every table.
  Anyone with privileged access (the operator, staff with `VIEW_HOLE_CARDS`,
  someone holding the database and `SEED_ENCRYPTION_KEY`) could relay that to a
  player in real time. Commit–reveal can neither prevent nor detect this.
  Mitigations are organisational: least privilege, audit-logged hole-card
  access, spectator delay.
- **N4 — Trust in the running server.** Players cannot see that the deployed
  server runs this repository's code. Verification catches a server that dealt
  *published* cards differently from the committed deck; it does not catch a
  server that deals correctly but leaks information (N3).
- **N5 — Only published cards are checked.** Hole cards of folded or mucked
  hands are private, so a public record withholds them (`cards: null`) and the
  public verifier cannot check them. Each player can verify **their own** hole
  cards through the player endpoint; withheld seats are listed in the result
  and a hand where every hole card is withheld is reported **INCOMPLETE**, never
  VERIFIED. Burn cards may also be withheld.
- **N6 — The records are the server's account.** The verifier checks that the
  records it is given match the committed deck. It cannot prove those records
  are what appeared on players' screens; only each player can confirm that for
  their own cards. Players are encouraged to verify their own hands.
- **N7 — Seed secrecy is not integrity.** If the seed leaks before the reveal,
  whoever has it knows every future card. Commit–reveal still proves the deck
  was not *changed*, but not that it stayed *secret*.
- **N8 — Seat and button draws** are derived from the same seed and entropy
  (`drawSource`, §4.6) and are reproducible, but the bundle verifier does not
  re-run the seating and balancing algorithms; an auditor can, using the
  documented algorithms in `docs/SEATING_AND_BALANCING.md`.
- **N9 — Game rules are out of scope.** The fairness verifier checks the deal
  only — not betting legality, pot sizes, hand rankings or payouts. Those are
  covered by the hand history, replay and the engines' own tests.
- **N10 — No entropy, no protection against precomputation.** If no client
  seeds were collected and no admin entropy was given, public entropy is the
  constant `2ea095f8…` (§5.2) and the operator could have precomputed decks
  from the moment it chose the seed. The verifier still checks integrity (G1–G3).

---

## 4. Exact constructions (byte level)

Conventions: **hex** is lowercase on output (verifiers accept either case for
seeds and digests); strings are encoded as **UTF-8** (unpaired UTF-16
surrogates are rejected, never replaced); integers are written in **decimal**
ASCII with no sign, padding or leading zeros; `||` is byte concatenation.

### 4.1 Server seed and commitment

```
serverSeed      = 32 bytes from the OS CSPRNG, stored and revealed as 64 hex chars
serverSeedHash  = hex( SHA-256( serverSeedBytes ) )        // over the 32 raw bytes, NOT the hex text
```

### 4.2 Public entropy

```
clientSeed      = 1..256 printable ASCII chars (0x21–0x7E) other than "," and "|"
                  (browsers send 64 lowercase hex chars)
preimage        = "JPB/v1/entropy|" + sort(clientSeeds).join(",") + "|" + (adminEntropy ?? "")
publicEntropy   = hex( SHA-256( UTF-8(preimage) ) )
```

`sort` is ascending by character code; client seeds are ASCII, so this equals
byte order in every language. Duplicates are kept. `adminEntropy` may be any
text (including `|` and `,`; it is the last field); `null` and `""` are
equivalent. The order in which seeds were received does not matter.

### 4.3 Labels (domain separation)

```
deck label   = "JPB/v1/deck|" + tournamentId + "|" + tableId + "|" + decimal(handNumber) + "|" + publicEntropy
draw label   = "JPB/v1/" + purpose + "|" + tournamentId + "|" + publicEntropy
```

`tournamentId`, `tableId` and `purpose` are non-empty and never contain `|`,
so different inputs always give different labels. `publicEntropy` is the
64-char lowercase hex string. Purposes are fixed strings: `seating`,
`final-table`, `button:{tableId}`; `deck` and `entropy` are reserved.

### 4.4 HMAC-SHA256 counter-mode stream

```
key       = serverSeedBytes (32 bytes)
block(i)  = HMAC-SHA256( key, UTF-8(label) || "|" || decimal(i) )      i = 0, 1, 2, ...
stream    = block(0) || block(1) || block(2) || ...
nextUint32() = the next 4 unread stream bytes, big-endian
```

### 4.5 Unbiased integers and the shuffle

```
uniformInt(n):            // 1 <= n <= 2^32
  limit = floor(2^32 / n) * n
  repeat u = nextUint32() until u < limit
  return u mod n

shuffle(a):               // Durstenfeld Fisher–Yates on a copy
  for i = len(a)-1 down to 1:
    j = uniformInt(i + 1)
    swap(a[i], a[j])
```

Every attempt consumes exactly one `nextUint32()` (also for n = 1).

### 4.6 Decks, deck hash, other draws

```
CANONICAL_DECK[i] = "23456789TJQKA"[i mod 13] + "cdhs"[floor(i / 13)]     i = 0..51
                  = 2c 3c … Ac 2d … Ad 2h … Ah 2s … As
deck(hand)        = shuffle(CANONICAL_DECK) using the stream of the deck label; deck[0] is the top card
deckHash          = hex( SHA-256( ASCII( deck.join("") ) ) )              // 104 characters, top card first
drawSource(p)     = the stream of the draw label (seat draw, final-table draw, button draws)
```

### 4.7 Dealing order

The `N` dealt-in seats are ordered clockwise (ascending seat index, wrapping
at `maxSeats`) starting with the **first seat after the button**. The button
seat may be empty (dead button); if occupied it is dealt last in each round.

```
hole card 1 of the k-th seat = deck[k]            k = 0 .. N-1
hole card 2 of the k-th seat = deck[N + k]
burn 1 = deck[2N],    flop  = deck[2N+1], deck[2N+2], deck[2N+3]
burn 2 = deck[2N+4],  turn  = deck[2N+5]
burn 3 = deck[2N+6],  river = deck[2N+7]
```

Positions never shift: a hand that ends early simply leaves later positions
undealt. A published board therefore has 0, 3, 4 or 5 cards, preceded by
0, 1, 2 or 3 burns. The poker engine deals exactly this way (cross-checked in
`packages/fairness-engine/test/dealing.test.ts`).

---

## 5. Known-answer vectors

Computed with `node:crypto` directly from the formulas above, independently of
the engine; the test suites assert them.

### 5.1 Stream (§4.4)

| Key (hex) | Label | i | block(i) |
| --- | --- | --- | --- |
| `000102…1e1f` (bytes 0..31) | `JPB/v1/test` | 0 | `30bfe8d7f155d9ab664dab9bc23042572c0eb184482b023c3fff4e847ac1c1cc` |
| same | same | 1 | `5399f1ce1df979bfc26336f06867e1414578aac2259fd16020b61a966b2f366d` |
| same | same | 2 | `5fbcace282a3db4aec7e12a584aba34abe0d3fac682e302ced48a70d6e3e1757` |
| `c0ffee` | `JPB/v1/ünïcödé ♠ 🂡` | 0 | `3df091c92656b61b19ced55c6ac4e8f297a25cdfd50bf35bea28e17fe79513ee` |
| same | same | 10 | `b1f5fef66de5d2d0aa67ca648641a950b6556e10d41aa6dad0d40d7c755e7b5a` |
| same | same | 123 | `1f761c53b91b3e3a8a4859d1c4ef3ba042acedffe8ab60ae4b4606a7f72e34d7` |
| `01` | *(empty)* | 0 | `c3b828d37771dc351605ae48fdf2af1f5b38e179d42df368bb71419ae96bfb05` |

On the first stream (key bytes 0..31, label `JPB/v1/test`):

- first `nextUint32()` values: `817883351, 4048935339, 1716366235, 3257942615, 739160452, …`
- `uniformInt(3000000000)` ×4: `817883351, 1716366235, 739160452, 1210778172`
  (`4048935339` and `3257942615` are ≥ limit = 3000000000 and rejected)
- `shuffle([0..9])` = `[5, 7, 9, 0, 2, 6, 4, 8, 3, 1]`

### 5.2 A complete hand

```
serverSeed      7f3a9c0e5b1d4f2a8c6e0b9d3f1a5c7e9b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a
serverSeedHash  48e66cbb9b09867577226dc0c03aba3db47d6843b72132554aa5a13af3d6c680
clientSeeds     "a1"×32, "0f"×32, "c3"×32   (any order)
adminEntropy    Johnny night #1
preimage        JPB/v1/entropy|0f0f…0f,a1a1…a1,c3c3…c3|Johnny night #1
publicEntropy   5fec1ce0b3dcd68e5a0bfb474f6b67f110900e96cb5fab8fbda22ded4021a362
tournamentId    trn_golden        tableId  trn_golden:T1        handNumber  7
deck label      JPB/v1/deck|trn_golden|trn_golden:T1|7|5fec1ce0b3dcd68e5a0bfb474f6b67f110900e96cb5fab8fbda22ded4021a362
block(0)        f20bdb123e97e29b7034bb9066a7cbba0820494362ee188bb8720efe73070f78
deck            Jd 4h Ah 8c 7d Js 3c Kc Qd 3s Ks 9s Jh 8s 5h 8h Ts 3d 3h Qc Td 5s 6d 8d Tc 6c
                Jc 2h 4d Kd 7h Qh 4s 9c Ad Kh 5d 7s Ac 6s 7c 2s 2d Qs As Th 2c 5c 9d 6h 9h 4c
deckHash        09ee7e41b162866a5d58ae08e61d018d4e41fc068e6392c0b5f7d90655fe1c3d
table           maxSeats 6, button seat 3, dealt-in seats 0, 2, 3, 5 → dealing order 5, 0, 2, 3
hole cards      seat 5: Jd 7d   seat 0: 4h Js   seat 2: Ah 3c   seat 3: 8c Kc
burns           Qd Jh 5h
board           3s Ks 9s | 8s | 8h
seating draw    first uint32 of "JPB/v1/seating|trn_golden|5fec…a362": 402487111, 3894643950, 2508272878
no inputs       publicEntropy of no client seeds and no admin entropy = 2ea095f8ad5537bb6f01630edeb3e42cb0b29ca54cdf2021416a3f374ce87486
```

---

## 6. Verifying a hand yourself, step by step

1. **Check the commitment you trust.** Note the `serverSeedHash` shown before
   registration opened (join page, screenshot, announcement). Everything else
   is only as good as this comparison: the verifier cannot know what was
   published in the past.
2. **Get the data.** After the tournament is completed or cancelled, fetch the
   tournament's fairness data (`GET /api/public/tournaments/:joinCode/fairness`:
   revealed `serverSeed`, `publicEntropy` and its inputs) and the hand records
   (`GET /api/public/hands/:handId/fairness`, or your own hands including your
   hole cards via `GET /api/player/hands/:handId/fairness`), or a JSON export
   (`FairnessExport`) from the Fairness page, which bundles all of it.
3. **Check the entropy.** If you kept the client seed your browser sent at
   registration, confirm it is in `clientSeeds`; recompute `publicEntropy` (§4.2).
4. **Check the seed.** `SHA-256(seed bytes)` must equal the commitment from step 1.
5. **Re-derive the deck** for the hand (§4.3–4.6) and compare its hash with the
   record's `deckHash`.
6. **Check the cards.** Order the dealt-in seats from the first seat after the
   button (§4.7), then compare every published hole card, the board and the
   burns with their deck positions.

The whole procedure in plain JavaScript, using only `node:crypto` (this is
`packages/fairness-engine/examples/verify-hand.mjs`, kept identical by a test):

```js
// Standalone JPB/v1 hand verifier. Node.js >= 18, node:crypto only, no dependencies.
// Usage: verifyHand(record, revealedServerSeedHex) with a HandFairnessRecord from the export.
import { createHash, createHmac } from 'node:crypto';

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const utf8 = (text) => Buffer.from(text, 'utf8');
const CANONICAL_DECK = [...'cdhs'].flatMap((suit) => [...'23456789TJQKA'].map((rank) => rank + suit));

export function publicEntropy(clientSeeds, adminEntropy) {
  const sorted = [...clientSeeds].sort(); // client seeds are printable ASCII: code-unit order = byte order
  return sha256Hex(utf8(`JPB/v1/entropy|${sorted.join(',')}|${adminEntropy ?? ''}`));
}

export function deriveDeck(serverSeedHex, tournamentId, tableId, handNumber, entropy) {
  const key = Buffer.from(serverSeedHex, 'hex');
  const label = `JPB/v1/deck|${tournamentId}|${tableId}|${handNumber}|${entropy}`;
  let block = Buffer.alloc(0);
  let offset = 0;
  let counter = 0;
  const nextUint32 = () => {
    if (offset === block.length) {
      block = createHmac('sha256', key)
        .update(utf8(`${label}|${counter++}`))
        .digest();
      offset = 0;
    }
    const value = block.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  const uniformInt = (n) => {
    const limit = Math.floor(2 ** 32 / n) * n;
    for (;;) {
      const u = nextUint32();
      if (u < limit) return u % n;
    }
  };
  const deck = CANONICAL_DECK.slice();
  for (let i = deck.length - 1; i >= 1; i--) {
    const j = uniformInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function verifyHand(record, serverSeedHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(serverSeedHex)) throw new Error('the seed must be 64 hex characters');
  const { tournamentId, tableId, handNumber, publicEntropy: entropy, maxSeats, buttonSeat } = record;
  const deck = deriveDeck(serverSeedHex, tournamentId, tableId, handNumber, entropy);
  // Dealing order: clockwise (ascending, wrapping) from the first seat after the button.
  const stepsFromButton = (seat) => (seat - buttonSeat - 1 + maxSeats) % maxSeats;
  const order = record.holeCards.map((h) => h.seat).sort((a, b) => stepsFromButton(a) - stepsFromButton(b));
  const n = order.length;
  const burns = [deck[2 * n], deck[2 * n + 4], deck[2 * n + 6]];
  const board = [deck[2 * n + 1], deck[2 * n + 2], deck[2 * n + 3], deck[2 * n + 5], deck[2 * n + 7]];
  const burnsForBoard = { 0: 0, 3: 1, 4: 2, 5: 3 }[record.board.length];
  return {
    SEED_COMMITMENT: sha256Hex(Buffer.from(serverSeedHex, 'hex')) === record.serverSeedHash.toLowerCase(),
    DECK_HASH: sha256Hex(deck.join('')) === record.deckHash.toLowerCase(),
    HOLE_CARDS: record.holeCards.every(({ seat, cards }) => {
      const k = order.indexOf(seat);
      return cards === null || (cards[0] === deck[k] && cards[1] === deck[n + k]);
    }),
    BOARD:
      burnsForBoard !== undefined &&
      record.board.every((card, i) => card === board[i]) &&
      (record.burns === null ||
        (record.burns.length === burnsForBoard && record.burns.every((card, i) => card === burns[i]))),
  };
}
```

Run it with Node 18+:

```js
import { readFileSync } from 'node:fs';
import { verifyHand } from './verify-hand.mjs';

const bundle = JSON.parse(readFileSync('fairness-export.json', 'utf8'));
for (const hand of bundle.hands) console.log(hand.handId, verifyHand(hand, bundle.serverSeed));
```

In a browser, `packages/fairness-engine/examples/verify-hand-webcrypto.mjs`
does the same with WebCrypto (`crypto.subtle`, asynchronous). Both scripts are
tested against the engine on random inputs. The admin dashboard and the public
verify page are specified to run the engine's portable `verifyHand` /
`verifyBundle` **in the browser** (`@jpb/fairness-engine` main entry has no
Node dependencies), so the verdict does not depend on the server's own answer.

### Reading a verification result

`verifyHand(record, revealedSeed)` reports four checks, always in this order:

| Check | VERIFIED when | Notes |
| --- | --- | --- |
| `SEED_COMMITMENT` | SHA-256 of the revealed seed bytes equals `serverSeedHash` | Seed not revealed → NOT_AVAILABLE. If this check is not VERIFIED, the other three are NOT_AVAILABLE: a deck derived from an uncommitted seed proves nothing. |
| `DECK_HASH` | the published deck hash equals the hash of the derived deck | |
| `HOLE_CARDS` | every published seat's two cards (in dealing order) equal their deck positions | Withheld seats are listed in `withheldSeats` and not checked; all withheld → NOT_AVAILABLE. Seats are matched by seat number, not by listing order. |
| `BOARD` | the published board (0/3/4/5 cards) and burns equal their deck positions | A hand that ended before the flop has nothing to differ and is VERIFIED with that explanation. Withheld burns are not checked. |

Overall: **VERIFIED** only if all four checks are VERIFIED; **FAILED** if any
check FAILED; otherwise **INCOMPLETE**. `verifyBundle` adds tournament-level
checks (`FORMAT`, `SEED_COMMITMENT`, `PUBLIC_ENTROPY`, `HAND_CONSISTENCY`) and
is VERIFIED only if those and every hand are VERIFIED; a bundle without entropy
inputs or without hands is at best INCOMPLETE. Both functions never throw on
untrusted input; malformed data is reported as FAILED.

---

## 7. Operating rules (for the server and admin tools)

- Create the seed with `createSeedCommitment()` from `@jpb/fairness-engine/node`
  when the tournament is created; store `serverSeed` encrypted; publish
  `serverSeedHash` **before** registration opens.
- Accept client seeds that satisfy §4.2 (the client SDK's `newClientSeed()`
  produces 64 lowercase hex characters).
- At START compute `computePublicEntropy({ clientSeeds, adminEntropy })` once,
  persist it (write-once) and publish it with its inputs. Never recompute it
  from a changed registration list.
- The table actor's `deckFor(handNumber)` is `deriveDeck({ serverSeed,
  tournamentId, tableId, handNumber, publicEntropy })`; seat and button draws
  use `drawSource({ …, purpose })`.
- Build each `HandFairnessRecord` from what the poker engine **actually dealt**
  (its events), never by re-deriving the deck — otherwise verification would
  be circular. Use `redactHandFairnessRecord` for public and per-player views.
- Reveal the seed only after COMPLETED / CANCELLED (dangerous operation
  `REVEAL_SEED`). Losing `SEED_ENCRYPTION_KEY` makes the reveal impossible.
