import type { TournamentConfig } from '@jpb/shared-types';

/** A complete, valid TournamentConfig for server tests (independent of @jpb/validation defaults). */
export function testTournamentConfig(overrides: Partial<TournamentConfig> = {}): TournamentConfig {
  const base: TournamentConfig = {
    name: 'Repo Test',
    joinCode: 'REPO01',
    game: 'NLH',
    minPlayers: 2,
    maxPlayers: 100,
    tables: { targetSize: 8, maxSize: 9, minSize: 2, finalTableSize: 9 },
    startingStack: 10_000,
    blindSchedule: [
      { level: 1, smallBlind: 50, bigBlind: 100, ante: 0, durationSeconds: 480 },
      { level: 2, smallBlind: 75, bigBlind: 150, ante: 0, durationSeconds: 480 },
    ],
    anteType: 'NONE',
    breaks: [],
    timing: {
      actionTimerSeconds: 15,
      awayActionTimerSeconds: 5,
      awayAfterTimeouts: 2,
      actionGraceMs: 500,
      timeoutBehavior: 'CHECK_ELSE_FOLD',
      betweenHandsDelayMs: 2000,
      showdownDelayMs: 2000,
      startCountdownSeconds: 30,
    },
    lateRegistration: { enabled: false, untilLevel: 0 },
    reentry: { enabled: false, maxEntriesPerPlayer: 1, untilLevel: 0 },
    prizeStructure: { currency: 'INR', places: [{ position: 1, amountMinor: 10_000_000 }, { position: 2, amountMinor: 6_000_000 }] },
    registration: { fields: [{ key: 'name', required: true }], requireApproval: false, accessCode: null },
    startTime: null,
    autoStart: false,
    registrationDeadline: null,
    spectators: { enabled: true, allowEliminatedPlayers: true, publicWatch: false, delaySeconds: 0 },
    balancing: { maxImbalance: 1, recentMoveWindowHands: 10, weights: { position: 1, blindFairness: 1, recentMove: 1, seatCompatibility: 0.1 }, consolidateBy: 'TARGET' },
    handForHand: { autoAtBubble: true },
    features: { spectatorMode: true, advancedFairnessAudit: true, lateRegistration: false, soundEffects: true, haptics: true, broadcastDisplay: true },
    speedMode: false,
  };
  return { ...base, ...overrides };
}
