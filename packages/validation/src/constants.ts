import { TABLE_SIZE_LIMITS } from '@jpb/shared-types';
import type { RegistrationFieldKey } from '@jpb/shared-types';
import type { Assert, Equals } from './typeAssert';

/**
 * Every bound enforced by the configuration schema. Named here so that the
 * README, the admin wizard and the tests all refer to the same numbers.
 */
export const CONFIG_LIMITS = {
  NAME_MAX_LENGTH: 80,

  MIN_PLAYERS: 2,
  /** Hard ceiling on a single tournament's field (spec: up to 10,000,000 players). */
  MAX_PLAYERS: 10_000_000,

  MIN_TABLE_SIZE: TABLE_SIZE_LIMITS.MIN_PLAYERS_PER_TABLE,
  MAX_TABLE_SIZE: TABLE_SIZE_LIMITS.ABSOLUTE_MAX_SEATS,

  MAX_BLIND_LEVELS: 500,
  MIN_LEVEL_SECONDS: 1,
  /** Shortest level allowed outside speed mode. */
  MIN_LEVEL_SECONDS_NORMAL: 60,
  MAX_LEVEL_SECONDS: 86_400,

  MAX_BREAKS: 100,
  MIN_BREAK_SECONDS: 1,
  /** Shortest break allowed outside speed mode. */
  MIN_BREAK_SECONDS_NORMAL: 60,
  MAX_BREAK_SECONDS: 86_400,
  BREAK_MESSAGE_MAX_LENGTH: 200,

  MIN_ACTION_TIMER_SECONDS: 1,
  /** Shortest action timer allowed outside speed mode (phones need time to react). */
  MIN_ACTION_TIMER_SECONDS_NORMAL: 5,
  MAX_ACTION_TIMER_SECONDS: 300,
  MAX_AWAY_AFTER_TIMEOUTS: 100,
  MAX_ACTION_GRACE_MS: 5_000,
  MAX_BETWEEN_HANDS_DELAY_MS: 60_000,
  MAX_SHOWDOWN_DELAY_MS: 60_000,
  MAX_START_COUNTDOWN_SECONDS: 3_600,

  MAX_ENTRIES_PER_PLAYER: 100,

  MAX_PRIZE_PLACES: 1_000_000,
  PRIZE_LABEL_MAX_LENGTH: 60,
  PRIZE_NOTES_MAX_LENGTH: 2_000,

  FIELD_LABEL_MAX_LENGTH: 40,

  MAX_SPECTATOR_DELAY_SECONDS: 3_600,

  MAX_IMBALANCE: TABLE_SIZE_LIMITS.ABSOLUTE_MAX_SEATS,
  MAX_RECENT_MOVE_WINDOW_HANDS: 1_000,
  /** Same bound as @jpb/seating-engine MAX_WEIGHT: keeps every weighted score finite. */
  MAX_WEIGHT: 1e9,
} as const;

/** Uppercase A–Z / 0–9, 4..12 characters (the QR join URL code). */
export const JOIN_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;
/** ISO 4217 alphabetic code: exactly three uppercase letters. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** Venue access code: 4..32 characters of A–Z, 0–9 or "-" (compared case-insensitively). */
export const ACCESS_CODE_PATTERN = /^[A-Z0-9-]{4,32}$/;

/** Every registration field key, in display order. Checked against RegistrationFieldKey at compile time. */
export const REGISTRATION_FIELD_KEYS = ['name', 'nickname', 'participantId', 'email', 'phone', 'collegeId'] as const;

type _RegistrationKeysExact = Assert<Equals<(typeof REGISTRATION_FIELD_KEYS)[number], RegistrationFieldKey>>;

/** Length limits (in Unicode code points, after sanitization) for registration fields. */
export const REGISTRATION_FIELD_LIMITS: Readonly<Record<RegistrationFieldKey, { min: number; max: number }>> = {
  name: { min: 1, max: 40 },
  nickname: { min: 1, max: 24 },
  participantId: { min: 1, max: 40 },
  email: { min: 3, max: 254 },
  phone: { min: 7, max: 20 },
  collegeId: { min: 1, max: 40 },
};

/** Default human labels for registration fields (used when the config gives none). */
export const REGISTRATION_FIELD_LABELS: Readonly<Record<RegistrationFieldKey, string>> = {
  name: 'Name',
  nickname: 'Nickname',
  participantId: 'Participant ID',
  email: 'Email',
  phone: 'Phone',
  collegeId: 'College ID',
};

/** Input limits shared by the request schemas. */
export const INPUT_LIMITS = {
  /** Raw (pre-sanitization) length cap for any free-text input, in UTF-16 code units. */
  MAX_RAW_TEXT_LENGTH: 1_024,
  /** Inclusive bounds of a client seed (hex characters). */
  CLIENT_SEED_MIN_LENGTH: 32,
  CLIENT_SEED_MAX_LENGTH: 128,
  /** Access codes typed by players. */
  ACCESS_CODE_MAX_LENGTH: 64,
  /** Opaque server ids (tournament/table/player ids). */
  ID_MAX_LENGTH: 128,
  /** Default WebSocket client frame limit (UTF-8 bytes). */
  CLIENT_MESSAGE_MAX_BYTES: 4_096,
  /** Highest protocol version number a client may announce in `hello`. */
  MAX_PROTOCOL_VERSION: 65_535,
  /** Admin reasons for audited operations. */
  REASON_MIN_LENGTH: 3,
  REASON_MAX_LENGTH: 500,
  ANNOUNCEMENT_MAX_LENGTH: 280,
  PAYMENT_REFERENCE_MAX_LENGTH: 120,
  PAYMENT_NOTE_MAX_LENGTH: 500,
  ADMIN_ENTROPY_MAX_LENGTH: 256,
  /** add-time bound: one day either way. */
  MAX_ADD_TIME_MS: 86_400_000,
  MAX_DEMO_PLAYERS: 100_000,
} as const;
