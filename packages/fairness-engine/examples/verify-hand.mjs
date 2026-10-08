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
