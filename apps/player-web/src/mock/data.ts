/**
 * Deterministic fixtures for the MOCK backend: blind schedule, prize ladder,
 * a 2,000-player field and tournament metadata.
 */
import type { BlindLevel, CurrentBlinds, PrizePlace, RegistrationFieldConfig } from '@jpb/shared-types';
import { code, hashSeed, hex, seededRng } from './rng';

export const MOCK_TOURNAMENT_ID = 'trn_8f3k2m9q';
export const MOCK_TOURNAMENT_NAME = 'Spring Showdown 2026';
export const MOCK_FIELD_SIZE = 2_000;
export const MOCK_STARTING_STACK = 10_000;
export const MOCK_CURRENCY = 'INR';
export const MOCK_SEED_HASH = hex(seededRng(hashSeed('server-seed')), 64);

const LEVEL_TABLE: ReadonlyArray<readonly [number, number, number]> = [
  [50, 100, 0],
  [75, 150, 0],
  [100, 200, 200],
  [150, 300, 300],
  [200, 400, 400],
  [300, 600, 600],
  [400, 800, 800],
  [500, 1_000, 1_000],
  [600, 1_200, 1_200],
  [800, 1_600, 1_600],
  [1_000, 2_000, 2_000],
  [1_500, 3_000, 3_000],
  [2_000, 4_000, 4_000],
  [2_500, 5_000, 5_000],
  [3_000, 6_000, 6_000],
  [4_000, 8_000, 8_000],
  [5_000, 10_000, 10_000],
  [6_000, 12_000, 12_000],
  [8_000, 16_000, 16_000],
  [10_000, 20_000, 20_000],
  [12_500, 25_000, 25_000],
  [15_000, 30_000, 30_000],
  [20_000, 40_000, 40_000],
  [25_000, 50_000, 50_000],
];

export const LEVELS: readonly BlindLevel[] = LEVEL_TABLE.map(([smallBlind, bigBlind, ante], i) => ({
  level: i + 1,
  smallBlind,
  bigBlind,
  ante,
  durationSeconds: 900,
}));

export function blindsFor(levelIndex: number): CurrentBlinds {
  const l = LEVELS[Math.min(levelIndex, LEVELS.length - 1)] as BlindLevel;
  return { level: l.level, smallBlind: l.smallBlind, bigBlind: l.bigBlind, ante: l.ante, anteType: l.ante > 0 ? 'BB_ANTE' : 'NONE' };
}

const RUPEE = 100; // paise per rupee
export const PRIZE_PLACES: readonly PrizePlace[] = [
  { position: 1, amountMinor: 250_000 * RUPEE, label: 'Champion' },
  { position: 2, amountMinor: 150_000 * RUPEE, label: 'Runner-up' },
  { position: 3, amountMinor: 100_000 * RUPEE },
  { position: 4, amountMinor: 75_000 * RUPEE },
  { position: 5, amountMinor: 60_000 * RUPEE },
  { position: 6, amountMinor: 50_000 * RUPEE },
  { position: 7, amountMinor: 40_000 * RUPEE },
  { position: 8, amountMinor: 32_000 * RUPEE },
  { position: 9, amountMinor: 25_000 * RUPEE },
  ...Array.from({ length: 9 }, (_, i) => ({ position: 10 + i, amountMinor: 15_000 * RUPEE })),
  ...Array.from({ length: 9 }, (_, i) => ({ position: 19 + i, amountMinor: 10_000 * RUPEE })),
];

export function prizeFor(position: number): number {
  return PRIZE_PLACES.find((p) => p.position === position)?.amountMinor ?? 0;
}

export const REGISTRATION_FIELDS: RegistrationFieldConfig[] = [
  { key: 'name', required: true, label: 'Full name' },
  { key: 'nickname', required: false, label: 'Table nickname' },
  { key: 'participantId', required: true, label: 'Ticket number' },
  { key: 'phone', required: false },
];

const FIRST = ['Kenji', 'Sofia', 'Diego', 'Wei', 'Ravi', 'Theo', 'Mila', 'Hannah', 'Ava', 'Arjun', 'Lena', 'Marcus', 'Priya', 'Ines', 'Noah', 'Aisha', 'Tomas', 'Yuki', 'Omar', 'Clara', 'Felix', 'Nadia', 'Rohan', 'Elena', 'Kofi', 'Mei', 'Lucas', 'Zara', 'Ivan', 'Leila', 'Arnav', 'Freya', 'Mateo', 'Sana', 'Jonas', 'Anika'];
const LAST = ['Watanabe', 'Lind', 'Alvarez', 'Zhang', 'Kapoor', 'Martins', 'Novak', 'Okafor', 'Brooks', 'Mehta', 'Fischer', 'Hale', 'Raman', 'Duarte', 'Becker', 'Khan', 'Silva', 'Tanaka', 'Haddad', 'Moreau', 'Weber', 'Petrov', 'Iyer', 'Rossi', 'Mensah', 'Chen', 'Costa', 'Ali', 'Sokolov', 'Nasser', 'Rao', 'Larsen', 'Garcia', 'Sheikh', 'Berg', 'Joshi'];

export interface FieldPlayer {
  playerId: string;
  publicId: string;
  displayName: string;
  /** Deterministic "form" used to rank the simulated field. */
  strength: number;
}

let fieldCache: FieldPlayer[] | null = null;

/** The other 1,999 players of the mock field (stable across calls). */
export function mockField(): FieldPlayer[] {
  if (fieldCache) return fieldCache;
  const rng = seededRng(hashSeed('field'));
  const used = new Set<string>();
  const out: FieldPlayer[] = [];
  for (let i = 0; out.length < MOCK_FIELD_SIZE - 1; i++) {
    const first = FIRST[i % FIRST.length] as string;
    const k = Math.floor(i / FIRST.length);
    const last = LAST[(k + i) % LAST.length] as string;
    const round = Math.floor(i / (FIRST.length * LAST.length));
    const middle = round === 0 ? '' : ` ${String.fromCharCode(65 + ((round * 7 + k) % 26))}.`;
    const name = `${first}${middle} ${last}`;
    if (used.has(name)) continue;
    const displayName = name;
    used.add(name);
    let publicId = `JPN-${code(rng, 4)}`;
    while (used.has(publicId)) publicId = `JPN-${code(rng, 4)}`;
    used.add(publicId);
    out.push({ playerId: `ply_${i.toString(36).padStart(4, '0')}`, publicId, displayName, strength: rng() });
  }
  out.sort((a, b) => b.strength - a.strength);
  fieldCache = out;
  return out;
}
