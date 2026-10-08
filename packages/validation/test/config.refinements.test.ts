import { describe, expect, it } from 'vitest';
import type { BlindLevel, TournamentConfig } from '@jpb/shared-types';
import { CONFIG_LIMITS, tournamentConfigSchema, validateTournamentConfig } from '../src';
import { config, expectIssue, expectOk, issuePaths } from './fixtures';

type Mutate = (c: TournamentConfig) => unknown;

function levels(n: number, f: (i: number) => Partial<BlindLevel> = () => ({})): BlindLevel[] {
  return Array.from({ length: n }, (_, i) => ({
    level: i + 1,
    smallBlind: 50 * (i + 1),
    bigBlind: 100 * (i + 1),
    ante: 0,
    durationSeconds: 600,
    ...f(i),
  }));
}

/** [description, mutation, expected issue path, message fragment]. */
const REJECTIONS: Array<[string, Mutate, string, string?]> = [
  // basics
  ['empty name', (c) => ({ ...c, name: '   ' }), 'name', 'empty'],
  ['markup in name', (c) => ({ ...c, name: 'Cup <script>' }), 'name', '<'],
  ['HTML entity in name', (c) => ({ ...c, name: 'Cup &lt;b&gt;' }), 'name', 'HTML'],
  ['name too long', (c) => ({ ...c, name: 'x'.repeat(CONFIG_LIMITS.NAME_MAX_LENGTH + 1) }), 'name', 'at most'],
  ['join code too short', (c) => ({ ...c, joinCode: 'AB1' }), 'joinCode', 'join code'],
  ['join code with symbols', (c) => ({ ...c, joinCode: 'AB-123' }), 'joinCode'],
  ['join code too long', (c) => ({ ...c, joinCode: 'A'.repeat(13) }), 'joinCode'],
  ['other game', (c) => ({ ...c, game: 'PLO' }), 'game', '"NLH"'],
  ['unknown top-level key', (c) => ({ ...c, rake: 5 }), '', 'Unknown field'],
  // players
  ['minPlayers below 2', (c) => ({ ...c, minPlayers: 1 }), 'minPlayers', 'at least 2'],
  ['maxPlayers below minPlayers', (c) => ({ ...c, minPlayers: 50, maxPlayers: 49 }), 'maxPlayers', 'at least the minimum'],
  ['maxPlayers above 10,000,000', (c) => ({ ...c, maxPlayers: 10_000_001 }), 'maxPlayers', '10,000,000'],
  ['fractional maxPlayers', (c) => ({ ...c, maxPlayers: 10.5 }), 'maxPlayers', 'whole number'],
  // tables
  ['minSize below 2', (c) => ({ ...c, tables: { ...c.tables, minSize: 1 } }), 'tables.minSize'],
  ['minSize above targetSize', (c) => ({ ...c, tables: { ...c.tables, minSize: 9 } }), 'tables.minSize', 'target size'],
  ['targetSize above maxSize', (c) => ({ ...c, tables: { ...c.tables, targetSize: 9, maxSize: 8, finalTableSize: 8 } }), 'tables.targetSize', 'maximum'],
  ['maxSize above 10', (c) => ({ ...c, tables: { ...c.tables, maxSize: 11 } }), 'tables.maxSize', 'at most 10'],
  ['finalTableSize below 2', (c) => ({ ...c, tables: { ...c.tables, finalTableSize: 1 } }), 'tables.finalTableSize'],
  ['finalTableSize above maxSize', (c) => ({ ...c, tables: { ...c.tables, finalTableSize: 10 } }), 'tables.finalTableSize', 'maximum table size'],
  // stack & schedule
  ['zero starting stack', (c) => ({ ...c, startingStack: 0 }), 'startingStack'],
  ['starting stack below level-1 big blind', (c) => ({ ...c, startingStack: 99 }), 'startingStack', 'level-1 big blind'],
  ['unsafe starting stack', (c) => ({ ...c, startingStack: 2 ** 53 }), 'startingStack'],
  ['empty schedule', (c) => ({ ...c, blindSchedule: [] }), 'blindSchedule', 'at least one level'],
  ['schedule starting at level 0', (c) => ({ ...c, blindSchedule: levels(3, (i) => ({ level: i })) }), 'blindSchedule[0].level'],
  ['schedule numbered with a gap', (c) => ({ ...c, blindSchedule: levels(3, (i) => ({ level: i === 2 ? 4 : i + 1 })) }), 'blindSchedule[2].level', 'expected 3'],
  ['schedule out of order', (c) => ({ ...c, blindSchedule: levels(2, (i) => ({ level: 2 - i })) }), 'blindSchedule[0].level'],
  ['zero small blind', (c) => ({ ...c, blindSchedule: levels(2, (i) => (i === 1 ? { smallBlind: 0 } : {})) }), 'blindSchedule[1].smallBlind', 'at least 1'],
  ['big blind below small blind', (c) => ({ ...c, blindSchedule: levels(2, (i) => (i === 1 ? { smallBlind: 300, bigBlind: 250 } : {})) }), 'blindSchedule[1].bigBlind', 'small blind'],
  ['decreasing big blind', (c) => ({ ...c, blindSchedule: levels(3, (i) => (i === 2 ? { smallBlind: 50, bigBlind: 100 } : {})) }), 'blindSchedule[2].bigBlind', 'must not decrease'],
  ['negative ante', (c) => ({ ...c, anteType: 'ALL_PLAYERS', blindSchedule: levels(2, () => ({ ante: -1 })) }), 'blindSchedule[0].ante'],
  ['ante with anteType NONE', (c) => ({ ...c, blindSchedule: levels(2, (i) => ({ ante: i * 10 })) }), 'blindSchedule[1].ante', 'NONE'],
  ['zero-second level', (c) => ({ ...c, blindSchedule: levels(1, () => ({ durationSeconds: 0 })) }), 'blindSchedule[0].durationSeconds'],
  ['30-second level outside speed mode', (c) => ({ ...c, blindSchedule: levels(2, () => ({ durationSeconds: 30 })) }), 'blindSchedule[1].durationSeconds', 'speed mode'],
  ['level longer than a day', (c) => ({ ...c, blindSchedule: levels(1, () => ({ durationSeconds: 86_401 })) }), 'blindSchedule[0].durationSeconds'],
  ['too many levels', (c) => ({ ...c, blindSchedule: levels(CONFIG_LIMITS.MAX_BLIND_LEVELS + 1) }), 'blindSchedule'],
  ['bad ante type', (c) => ({ ...c, anteType: 'BIG' }), 'anteType'],
  ['NaN blind', (c) => ({ ...c, blindSchedule: levels(1, () => ({ bigBlind: Number.NaN })) }), 'blindSchedule[0].bigBlind', 'finite'],
  ['unknown key in a level', (c) => ({ ...c, blindSchedule: [{ ...levels(1)[0]!, straddle: 1 }] }), 'blindSchedule[0]', 'Unknown field'],
  // breaks
  ['break with both afterLevel and everyLevels', (c) => ({ ...c, breaks: [{ afterLevel: 2, everyLevels: 4, durationSeconds: 300 }] }), 'breaks[0].everyLevels', 'not both'],
  ['break with neither', (c) => ({ ...c, breaks: [{ durationSeconds: 300 }] }), 'breaks[0].afterLevel', 'Choose'],
  ['break after a missing level', (c) => ({ ...c, breaks: [{ afterLevel: 21, durationSeconds: 300 }] }), 'breaks[0].afterLevel', 'no level 21'],
  ['break every N > levels', (c) => ({ ...c, breaks: [{ everyLevels: 25, durationSeconds: 300 }] }), 'breaks[0].everyLevels', 'never happens'],
  ['break of zero levels', (c) => ({ ...c, breaks: [{ everyLevels: 0, durationSeconds: 300 }] }), 'breaks[0].everyLevels'],
  ['30-second break outside speed mode', (c) => ({ ...c, breaks: [{ afterLevel: 2, durationSeconds: 30 }] }), 'breaks[0].durationSeconds', 'speed mode'],
  ['overlapping breaks', (c) => ({ ...c, breaks: [{ everyLevels: 2, durationSeconds: 300 }, { afterLevel: 4, durationSeconds: 600 }] }), 'breaks[1]', 'overlaps'],
  ['duplicate afterLevel', (c) => ({ ...c, breaks: [{ afterLevel: 3, durationSeconds: 300 }, { afterLevel: 3, durationSeconds: 300 }] }), 'breaks[1]', 'overlaps'],
  ['markup in break message', (c) => ({ ...c, breaks: [{ afterLevel: 3, durationSeconds: 300, message: '<b>Break</b>' }] }), 'breaks[0].message'],
  // timing
  ['action timer 0', (c) => ({ ...c, timing: { ...c.timing, actionTimerSeconds: 0, awayActionTimerSeconds: 0 } }), 'timing.actionTimerSeconds'],
  ['action timer above 300', (c) => ({ ...c, timing: { ...c.timing, actionTimerSeconds: 301 } }), 'timing.actionTimerSeconds', 'at most 300'],
  ['2-second action timer outside speed mode', (c) => ({ ...c, timing: { ...c.timing, actionTimerSeconds: 2, awayActionTimerSeconds: 1 } }), 'timing.actionTimerSeconds', 'speed mode'],
  ['away timer longer than the action timer', (c) => ({ ...c, timing: { ...c.timing, awayActionTimerSeconds: 16 } }), 'timing.awayActionTimerSeconds', 'longer'],
  ['grace above 5000 ms', (c) => ({ ...c, timing: { ...c.timing, actionGraceMs: 5001 } }), 'timing.actionGraceMs'],
  ['negative grace', (c) => ({ ...c, timing: { ...c.timing, actionGraceMs: -1 } }), 'timing.actionGraceMs'],
  ['between-hands delay above 60 s', (c) => ({ ...c, timing: { ...c.timing, betweenHandsDelayMs: 60_001 } }), 'timing.betweenHandsDelayMs'],
  ['showdown delay negative', (c) => ({ ...c, timing: { ...c.timing, showdownDelayMs: -5 } }), 'timing.showdownDelayMs'],
  ['start countdown above an hour', (c) => ({ ...c, timing: { ...c.timing, startCountdownSeconds: 3601 } }), 'timing.startCountdownSeconds'],
  ['awayAfterTimeouts 0', (c) => ({ ...c, timing: { ...c.timing, awayAfterTimeouts: 0 } }), 'timing.awayAfterTimeouts'],
  ['unknown timeout behavior', (c) => ({ ...c, timing: { ...c.timing, timeoutBehavior: 'FOLD' } }), 'timing.timeoutBehavior'],
  // late registration / re-entry
  ['late registration until level 0', (c) => ({ ...c, lateRegistration: { enabled: true, untilLevel: 0 } }), 'lateRegistration.untilLevel', 'between 1 and 20'],
  ['late registration beyond the schedule', (c) => ({ ...c, lateRegistration: { enabled: true, untilLevel: 21 } }), 'lateRegistration.untilLevel'],
  ['re-entry with one entry', (c) => ({ ...c, reentry: { enabled: true, maxEntriesPerPlayer: 1, untilLevel: 4 } }), 'reentry.maxEntriesPerPlayer', 'at least 2'],
  ['re-entry beyond the schedule', (c) => ({ ...c, reentry: { enabled: true, maxEntriesPerPlayer: 2, untilLevel: 99 } }), 'reentry.untilLevel'],
  ['re-entry with too many entries', (c) => ({ ...c, reentry: { enabled: true, maxEntriesPerPlayer: 101, untilLevel: 4 } }), 'reentry.maxEntriesPerPlayer'],
  // prizes
  ['prize positions starting at 2', (c) => ({ ...c, prizeStructure: { currency: 'INR', places: [{ position: 2, amountMinor: 10 }] } }), 'prizeStructure.places[0].position', 'expected 1'],
  ['prize positions with a gap', (c) => ({ ...c, prizeStructure: { currency: 'INR', places: [{ position: 1, amountMinor: 10 }, { position: 3, amountMinor: 5 }] } }), 'prizeStructure.places[1].position'],
  ['increasing prizes', (c) => ({ ...c, prizeStructure: { currency: 'INR', places: [{ position: 1, amountMinor: 10 }, { position: 2, amountMinor: 11 }] } }), 'prizeStructure.places[1].amountMinor', 'must not increase'],
  ['negative prize', (c) => ({ ...c, prizeStructure: { currency: 'INR', places: [{ position: 1, amountMinor: -1 }] } }), 'prizeStructure.places[0].amountMinor'],
  ['fractional prize', (c) => ({ ...c, prizeStructure: { currency: 'INR', places: [{ position: 1, amountMinor: 0.5 }] } }), 'prizeStructure.places[0].amountMinor', 'whole number'],
  ['prize pool beyond safe integers', (c) => ({ ...c, prizeStructure: { currency: 'INR', places: [{ position: 1, amountMinor: Number.MAX_SAFE_INTEGER }, { position: 2, amountMinor: Number.MAX_SAFE_INTEGER }] } }), 'prizeStructure.places', 'too large'],
  ['currency with two letters', (c) => ({ ...c, prizeStructure: { ...c.prizeStructure, currency: 'RS' } }), 'prizeStructure.currency', 'three-letter'],
  ['currency with digits', (c) => ({ ...c, prizeStructure: { ...c.prizeStructure, currency: 'IN1' } }), 'prizeStructure.currency'],
  ['more paid places than entries', (c) => ({ ...c, maxPlayers: 2, prizeStructure: { ...c.prizeStructure } }), 'prizeStructure.places', 'more paid places'],
  // registration config
  ['duplicate registration field', (c) => ({ ...c, registration: { ...c.registration, fields: [{ key: 'name', required: true }, { key: 'name', required: false }] } }), 'registration.fields[1].key', 'more than once'],
  ['unknown registration field', (c) => ({ ...c, registration: { ...c.registration, fields: [{ key: 'age', required: true }] } }), 'registration.fields[0].key'],
  ['no required display name', (c) => ({ ...c, registration: { ...c.registration, fields: [{ key: 'name', required: false }, { key: 'nickname', required: false }] } }), 'registration.fields[0].required', 'display name'],
  ['bad access code', (c) => ({ ...c, registration: { ...c.registration, accessCode: 'a b' } }), 'registration.accessCode'],
  // schedule times
  ['auto-start without a start time', (c) => ({ ...c, autoStart: true }), 'startTime', 'Auto-start'],
  ['deadline after the start', (c) => ({ ...c, startTime: 1_000, registrationDeadline: 2_000 }), 'registrationDeadline', 'after the scheduled start'],
  ['negative start time', (c) => ({ ...c, startTime: -1 }), 'startTime'],
  // spectators / balancing / flags
  ['spectator delay above an hour', (c) => ({ ...c, spectators: { ...c.spectators, delaySeconds: 3601 } }), 'spectators.delaySeconds'],
  ['negative balancing weight', (c) => ({ ...c, balancing: { ...c.balancing, weights: { ...c.balancing.weights, position: -0.5 } } }), 'balancing.weights.position'],
  ['infinite balancing weight', (c) => ({ ...c, balancing: { ...c.balancing, weights: { ...c.balancing.weights, recentMove: Number.POSITIVE_INFINITY } } }), 'balancing.weights.recentMove'],
  ['max imbalance 0', (c) => ({ ...c, balancing: { ...c.balancing, maxImbalance: 0 } }), 'balancing.maxImbalance'],
  ['bad consolidation mode', (c) => ({ ...c, balancing: { ...c.balancing, consolidateBy: 'MIN' } }), 'balancing.consolidateBy'],
  ['non-boolean feature flag', (c) => ({ ...c, features: { ...c.features, haptics: 'yes' } }), 'features.haptics', 'true or false'],
  ['missing speedMode', (c) => {
    const { speedMode: _s, ...rest } = c;
    return rest;
  }, 'speedMode', 'required'],
];

describe('tournament config refinements', () => {
  it.each(REJECTIONS)('rejects %s', (_name, mutate, path, text) => {
    expectIssue(validateTournamentConfig(mutate(config())), path, text);
  });

  it('the schema used directly rejects the same inputs', () => {
    for (const [name, mutate] of REJECTIONS) {
      expect(tournamentConfigSchema.safeParse(mutate(config())).success, name).toBe(false);
    }
  });

  it('reports independent problems at once (cross-field checks are not hidden by unrelated errors)', () => {
    const c = config();
    const result = validateTournamentConfig({
      ...c,
      name: '',
      timing: { ...c.timing, actionTimerSeconds: 1.5 },
      startingStack: 50,
      autoStart: true,
      surprise: true,
    });
    const paths = issuePaths(result);
    expect(paths).toEqual(expect.arrayContaining(['name', 'timing.actionTimerSeconds', 'startingStack', 'startTime', '']));
  });

  it('skips a cross-field check when a field it reads is itself invalid', () => {
    const c = config();
    // blindSchedule is invalid (gap), so "stack covers level-1 BB" is not evaluated on bad data.
    const result = validateTournamentConfig({ ...c, startingStack: 1, blindSchedule: levels(2, (i) => ({ level: i * 2 + 1 })) });
    expect(issuePaths(result)).toEqual(['blindSchedule[1].level']);
  });

  it('never runs checks on a non-object', () => {
    for (const input of [null, undefined, 42, 'config', [], true]) {
      const result = validateTournamentConfig(input);
      expect(issuePaths(result)).toEqual(['']);
    }
  });

  it('allows antes with BB_ANTE / ALL_PLAYERS, including ante-free early levels', () => {
    const bbAnte = config({ anteType: 'BB_ANTE', breaks: [], blindSchedule: levels(4, (i) => ({ ante: i < 2 ? 0 : 100 * (i + 1) })) });
    expect(validateTournamentConfig(bbAnte).ok).toBe(true);
    const allPlayers = config({ anteType: 'ALL_PLAYERS', breaks: [], blindSchedule: levels(4, (i) => ({ ante: 10 * (i + 1) })) });
    expect(validateTournamentConfig(allPlayers).ok).toBe(true);
  });

  it('allows equal consecutive big blinds and a single level', () => {
    expect(validateTournamentConfig(config({ breaks: [], blindSchedule: levels(3, () => ({ smallBlind: 50, bigBlind: 100 })) })).ok).toBe(true);
    expect(validateTournamentConfig(config({ blindSchedule: levels(1), breaks: [] })).ok).toBe(true);
  });

  it('accepts bounds exactly', () => {
    const c = config({
      minPlayers: 2,
      maxPlayers: CONFIG_LIMITS.MAX_PLAYERS,
      startingStack: 100,
      tables: { targetSize: 2, maxSize: 10, minSize: 2, finalTableSize: 2 },
      timing: { actionTimerSeconds: 300, awayActionTimerSeconds: 300, actionGraceMs: 5000, betweenHandsDelayMs: 0, showdownDelayMs: 0, startCountdownSeconds: 0 },
      prizeStructure: { places: [] },
    });
    expect(expectOk(validateTournamentConfig(c))).toEqual(c);
    expect(validateTournamentConfig(config({ tables: { targetSize: 10, maxSize: 10, minSize: 10, finalTableSize: 10 } })).ok).toBe(true);
  });

  it('rejects a recurring break that can never happen in a short schedule', () => {
    expectIssue(validateTournamentConfig(config({ blindSchedule: levels(4) })), 'breaks[0].everyLevels', 'never happens');
  });

  it('allows speed-mode-only values when speedMode is true', () => {
    const c = config({
      speedMode: true,
      blindSchedule: levels(3, () => ({ durationSeconds: 1 })),
      breaks: [{ afterLevel: 1, durationSeconds: 5 }],
      timing: { actionTimerSeconds: 1, awayActionTimerSeconds: 1 },
    });
    expect(validateTournamentConfig(c).ok).toBe(true);
    expectIssue(validateTournamentConfig(c, { allowSpeedMode: false }), 'speedMode', 'disabled');
  });

  it('accepts late registration and re-entry within the schedule', () => {
    const c = config({
      lateRegistration: { enabled: true, untilLevel: 20 },
      reentry: { enabled: true, maxEntriesPerPlayer: 3, untilLevel: 1 },
    });
    expect(validateTournamentConfig(c).ok).toBe(true);
  });

  it('ignores untilLevel / maxEntries when the feature is disabled', () => {
    const c = config({ lateRegistration: { enabled: false, untilLevel: 0 }, reentry: { enabled: false, maxEntriesPerPlayer: 5, untilLevel: 0 } });
    expect(validateTournamentConfig(c).ok).toBe(true);
  });

  it('counts re-entries when checking the chip total and paid places', () => {
    const tooMany = config({ maxPlayers: 2, prizeStructure: { places: [1, 2, 3].map((p) => ({ position: p, amountMinor: 10 - p })) } });
    expectIssue(validateTournamentConfig(tooMany), 'prizeStructure.places');
    const withReentry = { ...tooMany, reentry: { enabled: true, maxEntriesPerPlayer: 2, untilLevel: 3 } };
    expect(validateTournamentConfig(withReentry).ok).toBe(true);

    const big = config({ maxPlayers: CONFIG_LIMITS.MAX_PLAYERS, startingStack: 900_000_000 });
    expect(validateTournamentConfig(big).ok).toBe(true);
    expectIssue(validateTournamentConfig({ ...big, startingStack: 1_000_000_000 }), 'startingStack', 'chip total');
    expectIssue(validateTournamentConfig({ ...big, reentry: { enabled: true, maxEntriesPerPlayer: 2, untilLevel: 2 } }), 'startingStack');
  });

  it('accepts a deadline before (or at) the start and auto-start with a start time', () => {
    expect(validateTournamentConfig(config({ startTime: 5_000, registrationDeadline: 5_000, autoStart: true })).ok).toBe(true);
  });

  it('implicitly requires name when the field is not configured', () => {
    expect(validateTournamentConfig(config({ registration: { fields: [{ key: 'email', required: true }] } })).ok).toBe(true);
    expect(validateTournamentConfig(config({ registration: { fields: [] } })).ok).toBe(true);
    expect(validateTournamentConfig(config({ registration: { fields: [{ key: 'name', required: false }, { key: 'nickname', required: true }] } })).ok).toBe(true);
  });

  it('allows prizes of zero and equal prizes', () => {
    const c = config({ prizeStructure: { places: [{ position: 1, amountMinor: 5 }, { position: 2, amountMinor: 5 }, { position: 3, amountMinor: 0, label: 'Goodie bag' }] } });
    expect(validateTournamentConfig(c).ok).toBe(true);
  });

  it('issues come with friendly, path-labelled text', () => {
    const result = validateTournamentConfig(config({ tables: { minSize: 9 } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues[0]!.text).toBe('Tables › Min size: The minimum table size (9) must not exceed the target size (8).');
    expect(result.error.message).toBe(result.error.issues[0]!.text);
  });
});
