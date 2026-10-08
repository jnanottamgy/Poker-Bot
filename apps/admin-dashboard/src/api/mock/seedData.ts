import type { BlindLevel, BreakRule, PrizePlace, TournamentConfig } from '@jpb/shared-types';

export const FIRST_NAMES = [
  'Aarav', 'Aditi', 'Akira', 'Amara', 'Ana', 'Ananya', 'Arjun', 'Ava', 'Ben', 'Camila', 'Chen', 'Chloe', 'Daniel', 'Diego', 'Elena', 'Emil',
  'Fatima', 'Felix', 'Grace', 'Hana', 'Hannah', 'Ines', 'Isha', 'Ivan', 'Jae', 'Jonas', 'Kabir', 'Karan', 'Kenji', 'Kiara', 'Lena', 'Leo',
  'Lucia', 'Maya', 'Marcus', 'Meera', 'Mila', 'Nadia', 'Nikhil', 'Noah', 'Omar', 'Priya', 'Rahul', 'Ravi', 'Riya', 'Rohan', 'Sara', 'Sofia',
  'Tara', 'Theo', 'Uma', 'Vikram', 'Wei', 'Yara', 'Yusuf', 'Zara', 'Zoe', 'Ishaan', 'Neha', 'Sanjay', 'Tanvi', 'Dev', 'Asha', 'Kavya',
] as const;

export const LAST_NAMES = [
  'Agarwal', 'Alvarez', 'Bose', 'Brooks', 'Chopra', 'Costa', 'Das', 'Desai', 'Fischer', 'Gupta', 'Hale', 'Haddad', 'Iyer', 'Ito', 'Joshi',
  'Kapoor', 'Kim', 'Kowalski', 'Kumar', 'Lind', 'Malik', 'Martins', 'Mehta', 'Menon', 'Mishra', 'Nair', 'Novak', 'Okafor', 'Park', 'Patel',
  'Pillai', 'Rao', 'Reddy', 'Rossi', 'Sato', 'Shah', 'Sharma', 'Singh', 'Silva', 'Tan', 'Verma', 'Wagner', 'Watanabe', 'Yadav', 'Zhang',
  'Bhatt', 'Kulkarni', 'Banerjee', 'Ghosh', 'Saxena',
] as const;

export const NICKNAMES = ['Ace', 'River Rat', 'The Shark', 'Nuts', 'Chip Leader', 'Bluff King', 'Quads', 'Rookie', 'Grinder', 'Lucky 7', 'Snowman', 'Cowboy', 'Big Slick'] as const;

/** STANDARD-style structure: 20-minute levels, BB ante from level 4. */
export function standardSchedule(levels = 30, minutes = 20): BlindLevel[] {
  const bigs = [200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 80000, 100000, 120000, 150000, 200000];
  return Array.from({ length: levels }, (_, i) => {
    const bb = bigs[Math.min(i, bigs.length - 1)]!;
    return { level: i + 1, smallBlind: bb / 2, bigBlind: bb, ante: i >= 3 ? bb : 0, durationSeconds: minutes * 60 };
  });
}

export const DEFAULT_BREAKS: BreakRule[] = [{ everyLevels: 4, durationSeconds: 10 * 60, message: 'Ten-minute break. Stretch your legs!' }];

/** Pays the top ~12% with a decreasing ladder, totals in INR minor units (paise). */
export function prizeLadder(players: number, poolMinor: number): PrizePlace[] {
  const paid = Math.max(1, Math.min(players, Math.round(players * 0.12)));
  const weights = Array.from({ length: paid }, (_, i) => 1 / Math.pow(i + 1, 0.9));
  const sum = weights.reduce((a, b) => a + b, 0);
  let remaining = poolMinor;
  const places: PrizePlace[] = weights.map((w, i) => {
    // Round to whole rupees (100 paise); position 1 absorbs the remainder.
    const amount = i === 0 ? 0 : Math.floor(((poolMinor * w) / sum) / 100) * 100;
    remaining -= amount;
    return { position: i + 1, amountMinor: amount };
  });
  places[0] = { position: 1, amountMinor: remaining, label: 'Champion' };
  // Enforce non-increasing amounts after the remainder fix.
  for (let i = 1; i < places.length; i++) {
    if (places[i]!.amountMinor > places[i - 1]!.amountMinor) places[i] = { ...places[i]!, amountMinor: places[i - 1]!.amountMinor };
  }
  return places;
}

export function buildConfig(name: string, joinCode: string, maxPlayers: number, opts: { speedMode?: boolean; startTime?: number | null } = {}): TournamentConfig {
  return {
    name,
    joinCode,
    game: 'NLH',
    minPlayers: 2,
    maxPlayers,
    tables: { targetSize: 8, maxSize: 9, minSize: 2, finalTableSize: 9 },
    startingStack: 20_000,
    blindSchedule: standardSchedule(opts.speedMode ? 12 : 30, opts.speedMode ? 1 : 20),
    anteType: 'BB_ANTE',
    breaks: DEFAULT_BREAKS,
    timing: {
      actionTimerSeconds: 15,
      awayActionTimerSeconds: 5,
      awayAfterTimeouts: 2,
      actionGraceMs: 1500,
      timeoutBehavior: 'CHECK_ELSE_FOLD',
      betweenHandsDelayMs: 2500,
      showdownDelayMs: 4000,
      startCountdownSeconds: 30,
    },
    lateRegistration: { enabled: true, untilLevel: 6 },
    reentry: { enabled: false, maxEntriesPerPlayer: 1, untilLevel: 0 },
    prizeStructure: { currency: 'INR', places: prizeLadder(maxPlayers, maxPlayers * 50_000), notes: 'Trophy and goodie bag for the final table.' },
    registration: {
      fields: [
        { key: 'name', required: true },
        { key: 'nickname', required: false },
        { key: 'email', required: true },
        { key: 'phone', required: false },
        { key: 'collegeId', required: false },
      ],
      requireApproval: true,
      accessCode: 'SPADES',
    },
    startTime: opts.startTime ?? null,
    autoStart: false,
    registrationDeadline: null,
    spectators: { enabled: true, allowEliminatedPlayers: true, publicWatch: true, delaySeconds: 30 },
    balancing: { maxImbalance: 1, recentMoveWindowHands: 8, weights: { position: 4, blindFairness: 3, recentMove: 5, seatCompatibility: 1 }, consolidateBy: 'TARGET' },
    handForHand: { autoAtBubble: true },
    features: { spectatorMode: true, advancedFairnessAudit: true, lateRegistration: true, soundEffects: true, haptics: true, broadcastDisplay: true },
    speedMode: opts.speedMode ?? false,
  };
}
