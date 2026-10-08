/**
 * @jpb/validation — Zod 4 schemas for the tournament configuration and every
 * API / WebSocket input, plus blind-schedule presets and the default config.
 * Deterministic, no AI (docs/NO_AI.md). See README.md for every rule.
 */
export * from './constants';
export * from './text';
export * from './errors';
export * from './primitives';

export * from './config/tables';
export * from './config/blinds';
export * from './config/breaks';
export * from './config/timing';
export * from './config/prizes';
export * from './config/registration';
export * from './config/sections';
export * from './config/crossChecks';
export * from './config/tournamentConfig';
export * from './config/runningEdit';

export * from './presets/ladder';
export * from './presets/presets';
export * from './presets/defaults';

export * from './inputs/registration';
export * from './inputs/action';
export * from './inputs/clientMessage';
export * from './inputs/admin';

export type { Assert, Equals, Extends } from './typeAssert';
