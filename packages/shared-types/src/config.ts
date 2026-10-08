import type { Chips, EpochMs, MoneyMinor } from './ids';

/**
 * Tournament configuration. Every rule that could otherwise become a magic
 * number lives here. Validated by @jpb/validation before use; frozen
 * (immutable) once the tournament leaves REGISTRATION_CLOSED, except for the
 * explicitly-mutable fields documented in MUTABLE_WHILE_RUNNING.
 */
export interface TournamentConfig {
  name: string;
  /** Short public join code used in the QR URL, e.g. "ABC123". Uppercase A-Z0-9, 4..12 chars. */
  joinCode: string;
  game: 'NLH';

  minPlayers: number;
  maxPlayers: number;

  tables: TableSizeConfig;

  startingStack: Chips;
  blindSchedule: BlindLevel[];
  anteType: AnteType;
  breaks: BreakRule[];

  timing: TimingConfig;

  lateRegistration: LateRegistrationConfig;
  reentry: ReentryConfig;

  prizeStructure: PrizeStructure;
  registration: RegistrationConfig;

  /** Optional scheduled start; the director never starts automatically unless `autoStart` is true. */
  startTime: EpochMs | null;
  autoStart: boolean;
  registrationDeadline: EpochMs | null;

  spectators: SpectatorConfig;
  balancing: BalancingConfig;
  handForHand: HandForHandConfig;
  features: FeatureFlags;

  /**
   * Developer-only accelerated mode (1s blind levels etc). Refused by the
   * server in production unless SPEED_MODE_ALLOWED=true is set by an operator.
   */
  speedMode: boolean;
}

export interface TableSizeConfig {
  /** Target ("standard") players per table during normal play. Default 8. */
  targetSize: number;
  /** Hard upper bound of seats per table. Default 9. Must be >= targetSize and <= 10. */
  maxSize: number;
  /** A table with fewer than this many players is a candidate for breaking. Default 2. */
  minSize: number;
  /** Players remaining at which all tables consolidate into the final table. Default 9. Must be <= maxSize. */
  finalTableSize: number;
}

export type AnteType = 'NONE' | 'BB_ANTE' | 'ALL_PLAYERS';

export interface BlindLevel {
  /** 1-based level number. */
  level: number;
  smallBlind: Chips;
  bigBlind: Chips;
  /** Per-player ante (ALL_PLAYERS) or the total ante posted by the big blind (BB_ANTE). 0 when anteType is NONE. */
  ante: Chips;
  durationSeconds: number;
}

/**
 * A break is taken after the configured level ends. Use either `afterLevel`
 * (one specific level) or `everyLevels` (recurring). Breaks never interrupt a
 * hand in progress: tables finish their current hand, then hold.
 */
export interface BreakRule {
  afterLevel?: number;
  everyLevels?: number;
  durationSeconds: number;
  message?: string;
}

export type TimeoutBehavior = 'CHECK_ELSE_FOLD';

export interface TimingConfig {
  /** Server-authoritative time per action. Default 15. */
  actionTimerSeconds: number;
  /** Optional shorter timer for players who are disconnected or timed out N times in a row. */
  awayActionTimerSeconds: number;
  /** Consecutive timeouts before a player is treated as "away". */
  awayAfterTimeouts: number;
  /**
   * Network grace added server-side to every action deadline so that a click
   * made before the visible countdown hit zero is not rejected due to
   * latency. Deterministic: deadline + grace is the hard cutoff.
   */
  actionGraceMs: number;
  timeoutBehavior: TimeoutBehavior;
  /** Pause between a completed hand and the next deal (lets clients animate). */
  betweenHandsDelayMs: number;
  /** Extra pause after a showdown before the next deal. */
  showdownDelayMs: number;
  /** Delay before the very first hand once seats are announced. */
  startCountdownSeconds: number;
}

export interface LateRegistrationConfig {
  enabled: boolean;
  /** Registration stays open through the end of this level. */
  untilLevel: number;
}

export interface ReentryConfig {
  enabled: boolean;
  /** Maximum entries per player including the first. */
  maxEntriesPerPlayer: number;
  /** Re-entry allowed through the end of this level. */
  untilLevel: number;
}

export interface PrizeStructure {
  /** ISO 4217 code, e.g. "INR". Display only — chips are never money. */
  currency: string;
  /** Fixed payouts by finishing position. Positions must be 1..N contiguous. */
  places: PrizePlace[];
  /** Optional non-monetary prize descriptions (trophies, goodies). */
  notes?: string;
}

export interface PrizePlace {
  position: number;
  amountMinor: MoneyMinor;
  label?: string;
}

export type RegistrationFieldKey = 'name' | 'nickname' | 'participantId' | 'email' | 'phone' | 'collegeId';

export interface RegistrationFieldConfig {
  key: RegistrationFieldKey;
  required: boolean;
  label?: string;
}

export interface RegistrationConfig {
  fields: RegistrationFieldConfig[];
  /** If true, staff must approve each registration before it counts. */
  requireApproval: boolean;
  /** Optional shared access code printed at the venue to keep strangers out. */
  accessCode: string | null;
}

export interface SpectatorConfig {
  enabled: boolean;
  /** Eliminated players may keep watching. */
  allowEliminatedPlayers: boolean;
  /** Anyone with the link can watch (public cards and actions only). */
  publicWatch: boolean;
  /** Seconds of delay applied to spectator streams to reduce ghosting. */
  delaySeconds: number;
}

/** Weights for the documented movement-score formula in @jpb/balancing-engine. */
export interface BalancingConfig {
  /** Rebalance when (largest table - smallest table) > maxImbalance. Default 1. */
  maxImbalance: number;
  /** Window (in hands) for the recent-move penalty. */
  recentMoveWindowHands: number;
  weights: {
    position: number;
    blindFairness: number;
    recentMove: number;
    seatCompatibility: number;
  };
  /** When to consolidate: 'TARGET' uses ceil(active/targetSize) tables; 'MAX' uses ceil(active/maxSize). */
  consolidateBy: 'TARGET' | 'MAX';
}

export interface HandForHandConfig {
  /** Automatically switch to hand-for-hand when active players == paid places + 1 (the bubble). */
  autoAtBubble: boolean;
}

export interface FeatureFlags {
  spectatorMode: boolean;
  advancedFairnessAudit: boolean;
  lateRegistration: boolean;
  soundEffects: boolean;
  haptics: boolean;
  broadcastDisplay: boolean;
}

/** Fields an authorized admin may change while the tournament runs (each change is audit-logged). */
export const MUTABLE_WHILE_RUNNING = [
  'blindSchedule.futureLevels',
  'breaks',
  'timing.actionTimerSeconds',
  'timing.awayActionTimerSeconds',
  'spectators',
  'features',
] as const;

export const TABLE_SIZE_LIMITS = { MIN_PLAYERS_PER_TABLE: 2, ABSOLUTE_MAX_SEATS: 10 } as const;
