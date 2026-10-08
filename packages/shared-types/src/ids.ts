/**
 * Identifier aliases.
 *
 * Internal IDs are opaque, server-generated, cryptographically random strings
 * (never sequential, never client-chosen). Public identifiers (e.g. the
 * player's "JPN-7A42" handle or a tournament join code) are separate fields
 * and are never used for authorization.
 */
export type TournamentId = string;
export type TableId = string;
export type PlayerId = string;
export type EntryId = string;
export type HandId = string;
export type ActionId = string;
export type AdminId = string;
export type SessionId = string;

/** Seat index at a table, 0-based. Clockwise order is ascending index, wrapping at maxSeats. */
export type SeatIndex = number;

/** Milliseconds since Unix epoch, always measured by the server clock. */
export type EpochMs = number;

/** Chip amounts are non-negative safe integers. Never fractional. */
export type Chips = number;

/** Money in minor currency units (e.g. paise for INR). Integer only. Kept entirely separate from chips. */
export type MoneyMinor = number;
