import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BlindLevel, BreakRule, PrizePlace, RegistrationFieldConfig, TournamentConfig } from '@jpb/shared-types';
import { REGISTRATION_FIELD_KEYS, defaultTournamentConfig, tournamentConfigSchema, validateTournamentConfig } from '../src';
import { withPath } from './fixtures';

const RUNS = 300;

// ---------------------------------------------------------------- arbitrary VALID configs

const scheduleArb = (speedMode: boolean, anteType: TournamentConfig['anteType']): fc.Arbitrary<BlindLevel[]> =>
  fc
    .record({
      startBB: fc.integer({ min: 1, max: 1000 }),
      steps: fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 0, maxLength: 29 }),
      durations: fc.array(fc.integer({ min: speedMode ? 1 : 60, max: 3600 }), { minLength: 30, maxLength: 30 }),
      sbFractions: fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 30, maxLength: 30 }),
      anteFractions: fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 30, maxLength: 30 }),
    })
    .map(({ startBB, steps, durations, sbFractions, anteFractions }) => {
      const bbs = [startBB];
      for (const s of steps) bbs.push(bbs[bbs.length - 1]! + s);
      return bbs.map((bb, i) => ({
        level: i + 1,
        smallBlind: Math.max(1, Math.floor((bb * sbFractions[i]!) / 100)),
        bigBlind: bb,
        ante: anteType === 'NONE' ? 0 : Math.floor((bb * anteFractions[i]!) / 100),
        durationSeconds: durations[i]!,
      }));
    });

const registrationFieldsArb: fc.Arbitrary<RegistrationFieldConfig[]> = fc
  .tuple(fc.subarray([...REGISTRATION_FIELD_KEYS]), fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }))
  .map(([keys, required]) => keys.map((key, i) => ({ key, required: required[i]! })))
  .map((fields) => {
    const name = fields.find((f) => f.key === 'name');
    const nickname = fields.find((f) => f.key === 'nickname');
    if (name !== undefined && !name.required && !(nickname?.required ?? false)) name.required = true;
    return fields;
  });

function breaksFor(levels: number, picks: number[], durations: number[]): BreakRule[] {
  const after = [...new Set(picks.map((p) => (p % levels) + 1))];
  return after.map((afterLevel, i) => ({ afterLevel, durationSeconds: durations[i % durations.length]! }));
}

export const validConfigArb: fc.Arbitrary<TournamentConfig> = fc
  .record({
    speedMode: fc.boolean(),
    anteType: fc.constantFrom<TournamentConfig['anteType']>('NONE', 'BB_ANTE', 'ALL_PLAYERS'),
    minSize: fc.integer({ min: 2, max: 10 }),
    sizeSteps: fc.tuple(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 8 }), fc.integer({ min: 0, max: 8 })),
    minPlayers: fc.integer({ min: 2, max: 1000 }),
    extraPlayers: fc.integer({ min: 0, max: 100_000 }),
    name: fc.constantFrom('Spring Cup', "Johnny's Night", 'Turnier Ä', '冠军赛', 'Final 2026'),
    joinCode: fc.stringMatching(/^[A-Z0-9]{4,12}$/),
  })
  .chain((base) =>
    fc
      .record({
        schedule: scheduleArb(base.speedMode, base.anteType),
        stackExtra: fc.integer({ min: 0, max: 1_000_000 }),
        breakPicks: fc.array(fc.nat(), { maxLength: 4 }),
        breakDurations: fc.array(fc.integer({ min: base.speedMode ? 1 : 60, max: 3600 }), { minLength: 1, maxLength: 4 }),
        actionTimer: fc.integer({ min: base.speedMode ? 1 : 5, max: 300 }),
        awayFraction: fc.integer({ min: 1, max: 100 }),
        grace: fc.integer({ min: 0, max: 5000 }),
        delays: fc.tuple(fc.integer({ min: 0, max: 60_000 }), fc.integer({ min: 0, max: 60_000 }), fc.integer({ min: 0, max: 3600 })),
        lateReg: fc.option(fc.nat(), { nil: null }),
        reentry: fc.option(fc.tuple(fc.integer({ min: 2, max: 100 }), fc.nat()), { nil: null }),
        prizes: fc.array(fc.integer({ min: 0, max: 1_000_000 }), { maxLength: 10 }),
        fields: registrationFieldsArb,
        requireApproval: fc.boolean(),
        accessCode: fc.option(fc.stringMatching(/^[A-Z0-9-]{4,32}$/), { nil: null }),
        times: fc.option(fc.tuple(fc.integer({ min: 0, max: 2 ** 45 }), fc.integer({ min: 0, max: 2 ** 40 })), { nil: null }),
        autoStart: fc.boolean(),
        flags: fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
        delay: fc.integer({ min: 0, max: 3600 }),
        weights: fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), { minLength: 4, maxLength: 4 }),
        maxImbalance: fc.integer({ min: 1, max: 10 }),
        window: fc.integer({ min: 0, max: 1000 }),
        finalPick: fc.nat(),
      })
      .map((r): TournamentConfig => {
        const targetSize = Math.min(10, base.minSize + base.sizeSteps[0]);
        const maxSize = Math.min(10, targetSize + base.sizeSteps[1]);
        const finalTableSize = 2 + (r.finalPick % (maxSize - 1));
        const levels = r.schedule.length;
        const maxPlayers = base.minPlayers + base.extraPlayers;
        const reentry = r.reentry === null
          ? { enabled: false, maxEntriesPerPlayer: 1, untilLevel: 0 }
          : { enabled: true, maxEntriesPerPlayer: r.reentry[0], untilLevel: (r.reentry[1] % levels) + 1 };
        const sortedPrizes = [...r.prizes].sort((a, b) => b - a).slice(0, maxPlayers);
        const places: PrizePlace[] = sortedPrizes.map((amountMinor, i) => ({ position: i + 1, amountMinor }));
        const startTime = r.times === null ? null : r.times[0] + r.times[1];
        return {
          name: base.name,
          joinCode: base.joinCode,
          game: 'NLH',
          minPlayers: base.minPlayers,
          maxPlayers,
          tables: { targetSize, maxSize, minSize: base.minSize, finalTableSize },
          startingStack: r.schedule[0]!.bigBlind + r.stackExtra,
          blindSchedule: r.schedule,
          anteType: base.anteType,
          breaks: breaksFor(levels, r.breakPicks, r.breakDurations),
          timing: {
            actionTimerSeconds: r.actionTimer,
            awayActionTimerSeconds: Math.max(1, Math.floor((r.actionTimer * r.awayFraction) / 100)),
            awayAfterTimeouts: 2,
            actionGraceMs: r.grace,
            timeoutBehavior: 'CHECK_ELSE_FOLD',
            betweenHandsDelayMs: r.delays[0],
            showdownDelayMs: r.delays[1],
            startCountdownSeconds: r.delays[2],
          },
          lateRegistration: r.lateReg === null ? { enabled: false, untilLevel: 0 } : { enabled: true, untilLevel: (r.lateReg % levels) + 1 },
          reentry,
          prizeStructure: { currency: 'INR', places },
          registration: { fields: r.fields, requireApproval: r.requireApproval, accessCode: r.accessCode },
          startTime,
          autoStart: startTime !== null && r.autoStart,
          registrationDeadline: r.times === null ? null : r.times[0],
          spectators: { enabled: r.flags[0]!, allowEliminatedPlayers: r.flags[1]!, publicWatch: r.flags[2]!, delaySeconds: r.delay },
          balancing: {
            maxImbalance: r.maxImbalance,
            recentMoveWindowHands: r.window,
            weights: { position: r.weights[0]!, blindFairness: r.weights[1]!, recentMove: r.weights[2]!, seatCompatibility: r.weights[3]! },
            consolidateBy: r.flags[3]! ? 'TARGET' : 'MAX',
          },
          handForHand: { autoAtBubble: r.flags[4]! },
          features: {
            spectatorMode: r.flags[5]!,
            advancedFairnessAudit: r.flags[6]!,
            lateRegistration: r.flags[7]!,
            soundEffects: r.flags[8]!,
            haptics: r.flags[9]!,
            broadcastDisplay: r.flags[0]!,
          },
          speedMode: base.speedMode,
        };
      }),
  );

// ---------------------------------------------------------------- hostile values

const nastyValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.anything(),
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0,
    0.5,
    -1,
    2 ** 53,
    Number.MAX_VALUE,
    '',
    ' ',
    '<script>alert(1)</script>',
    '\u0000',
    '\u202E',
    null,
    undefined,
    [],
    {},
    true,
    '10',
  ),
  fc.string({ unit: 'binary', maxLength: 50 }),
  fc.integer(),
  fc.double(),
);

/** Every path of the default config down to its leaves (objects and arrays included). */
function allPaths(value: unknown, prefix: Array<string | number> = []): Array<Array<string | number>> {
  const out: Array<Array<string | number>> = [prefix];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...allPaths(v, [...prefix, i])));
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) out.push(...allPaths(v, [...prefix, k]));
  }
  return out;
}

const PATHS = allPaths(defaultTournamentConfig()).filter((p) => p.length > 0);

function throwsNothing(input: unknown): boolean {
  const result = validateTournamentConfig(input);
  if (result.ok) {
    const again = validateTournamentConfig(result.value);
    return again.ok && JSON.stringify(again.value) === JSON.stringify(result.value);
  }
  return result.error.message.length > 0 && result.error.issues.every((i) => typeof i.message === 'string' && i.message.length > 0);
}

describe('config fuzzing', () => {
  it('every generated valid config validates, unchanged', () => {
    fc.assert(
      fc.property(validConfigArb, (cfg) => {
        const result = validateTournamentConfig(cfg);
        if (!result.ok) throw new Error(JSON.stringify(result.error.issues.map((i) => `${i.path}: ${i.message}`)));
        expect(result.value).toEqual(cfg);
      }),
      { numRuns: RUNS },
    );
  });

  it('random values never crash validation (only pass/fail)', () => {
    fc.assert(fc.property(fc.anything(), (input) => throwsNothing(input)), { numRuns: RUNS });
    fc.assert(fc.property(fc.jsonValue(), (input) => throwsNothing(input)), { numRuns: RUNS });
  });

  it('random objects shaped like a config never crash validation', () => {
    const shaped = fc.dictionary(fc.constantFrom(...Object.keys(defaultTournamentConfig()), 'extra', '__proto__'), nastyValue);
    fc.assert(fc.property(shaped, (input) => throwsNothing(input)), { numRuns: RUNS });
  });

  it('replacing any field of a valid config with a hostile value never crashes; accepted results are idempotent', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PATHS), nastyValue, (path, value) => throwsNothing(withPath(defaultTournamentConfig(), path, value))),
      { numRuns: 2000 },
    );
  });

  it('mutating several fields of random valid configs never crashes', () => {
    fc.assert(
      fc.property(validConfigArb, fc.array(fc.tuple(fc.constantFrom(...PATHS), nastyValue), { maxLength: 4 }), (cfg, edits) => {
        let input: unknown = cfg;
        for (const [path, value] of edits) input = withPath(input, path, value);
        return throwsNothing(input);
      }),
      { numRuns: RUNS },
    );
  });

  it('the bare schema never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        tournamentConfigSchema.safeParse(input);
      }),
      { numRuns: RUNS },
    );
  });

  it('hostile objects (throwing getters, proxies) produce a failure, not an exception', () => {
    const throwing = Object.defineProperty({ ...defaultTournamentConfig() }, 'name', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
        ownKeys() {
          throw new Error('trap');
        },
      },
    );
    for (const input of [throwing, proxy]) {
      const result = validateTournamentConfig(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).not.toMatch(/boom|trap|Error|at /);
    }
  });

  it('never mutates its input', () => {
    fc.assert(
      fc.property(validConfigArb, (cfg) => {
        const before = JSON.stringify(cfg);
        validateTournamentConfig(cfg);
        expect(JSON.stringify(cfg)).toBe(before);
      }),
      { numRuns: 100 },
    );
  });
});
