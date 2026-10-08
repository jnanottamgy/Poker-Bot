import fc from 'fast-check';
import { commitmentFor } from '../src';
import type { HonestHandSpec } from './fixtures';

export const hex = (bytes: number): fc.Arbitrary<string> =>
  fc.uint8Array({ minLength: bytes, maxLength: bytes }).map((b) => Buffer.from(b).toString('hex'));

/** Ids as the server makes them (letters, digits, "_", ":", "-"), never containing "|". */
export const id = fc.stringMatching(/^[A-Za-z0-9_:-]{1,24}$/);

/** A random table configuration: maxSeats, button (any seat, possibly empty) and 2..maxSeats dealt-in seats. */
export const tableConfig = fc.integer({ min: 2, max: 10 }).chain((maxSeats) =>
  fc.record({
    maxSeats: fc.constant(maxSeats),
    buttonSeat: fc.integer({ min: 0, max: maxSeats - 1 }),
    seats: fc.uniqueArray(fc.integer({ min: 0, max: maxSeats - 1 }), { minLength: 2, maxLength: maxSeats }),
  }),
);

export const honestSpec: fc.Arbitrary<HonestHandSpec> = fc
  .record({
    serverSeed: hex(32),
    tournamentId: id,
    tableId: id,
    handNumber: fc.integer({ min: 0, max: 1_000_000 }),
    publicEntropy: hex(32),
    table: tableConfig,
    boardSize: fc.constantFrom(0, 3, 4, 5),
  })
  .map(({ table, ...rest }) => ({ ...rest, ...table, serverSeedHash: commitmentFor(rest.serverSeed) }));
