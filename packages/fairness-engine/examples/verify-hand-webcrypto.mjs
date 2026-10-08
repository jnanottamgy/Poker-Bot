// Standalone JPB/v1 deck derivation for browsers (WebCrypto only, no dependencies).
// WebCrypto is asynchronous, so every stream block is awaited.
const encoder = new TextEncoder();
const toHex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
const CANONICAL_DECK = [...'cdhs'].flatMap((suit) => [...'23456789TJQKA'].map((rank) => rank + suit));

export const sha256Hex = async (bytes) => toHex(await crypto.subtle.digest('SHA-256', bytes));

/** serverSeedHash = SHA-256 of the 32 seed bytes (not of the hex text). */
export const commitment = (serverSeedHex) => sha256Hex(fromHex(serverSeedHex));

export async function deriveDeck(serverSeedHex, tournamentId, tableId, handNumber, publicEntropy) {
  const key = await crypto.subtle.importKey('raw', fromHex(serverSeedHex), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const label = `JPB/v1/deck|${tournamentId}|${tableId}|${handNumber}|${publicEntropy}`;
  let block = new Uint8Array(0);
  let offset = 0;
  let counter = 0;
  const nextUint32 = async () => {
    if (offset === block.length) {
      block = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${label}|${counter++}`)));
      offset = 0;
    }
    const value = new DataView(block.buffer).getUint32(offset); // big-endian
    offset += 4;
    return value;
  };
  const uniformInt = async (n) => {
    const limit = Math.floor(2 ** 32 / n) * n;
    for (;;) {
      const u = await nextUint32();
      if (u < limit) return u % n;
    }
  };
  const deck = CANONICAL_DECK.slice();
  for (let i = deck.length - 1; i >= 1; i--) {
    const j = await uniformInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export const deckHash = (deck) => sha256Hex(encoder.encode(deck.join('')));
