import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BlindLevel } from '@jpb/shared-types';
import {
  BIG_BLIND_LADDER,
  BLIND_PRESETS,
  BLIND_PRESET_NAMES,
  SCALING_GRID,
  blindScheduleSchema,
  defaultTournamentConfig,
  floorGridIndex,
  generateBlindSchedule,
  generatedAnte,
  nearestGridIndex,
  presetBreaks,
  presetTiming,
  projectSchedule,
  scaleBlindSchedule,
  startingDepthInBigBlinds,
  validateTournamentConfig,
} from '../src';

describe('ladders', () => {
  it('BIG_BLIND_LADDER starts 2, 3, 4, 6, 10, 15, 20, 30, 40, 60, 100 and is strictly increasing', () => {
    expect(BIG_BLIND_LADDER.slice(0, 11)).toEqual([2, 3, 4, 6, 10, 15, 20, 30, 40, 60, 100]);
    for (let i = 1; i < BIG_BLIND_LADDER.length; i++) expect(BIG_BLIND_LADDER[i]!).toBeGreaterThan(BIG_BLIND_LADDER[i - 1]!);
    expect(BIG_BLIND_LADDER.every((v) => Number.isSafeInteger(v))).toBe(true);
    expect(BIG_BLIND_LADDER[BIG_BLIND_LADDER.length - 1]).toBe(6e15);
  });

  it('SCALING_GRID contains every ladder rung and is strictly increasing', () => {
    const grid = new Set(SCALING_GRID);
    expect(BIG_BLIND_LADDER.every((v) => grid.has(v))).toBe(true);
    for (let i = 1; i < SCALING_GRID.length; i++) expect(SCALING_GRID[i]!).toBeGreaterThan(SCALING_GRID[i - 1]!);
    expect(SCALING_GRID.slice(0, 17)).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(BIG_BLIND_LADDER)).toBe(true);
    expect(Object.isFrozen(SCALING_GRID)).toBe(true);
    expect(Object.isFrozen(BLIND_PRESETS.STANDARD.timing)).toBe(true);
  });

  it('nearestGridIndex picks the nearest value, ties up, exact rationals', () => {
    const grid = [10, 20, 40];
    const at = (num: number, den = 1) => grid[nearestGridIndex(grid, { num: BigInt(num), den: BigInt(den) })];
    expect(at(14)).toBe(10);
    expect(at(15)).toBe(20); // tie → larger
    expect(at(16)).toBe(20);
    expect(at(30)).toBe(40); // tie → larger
    expect(at(0)).toBe(10);
    expect(at(1000)).toBe(40);
    expect(at(29, 2)).toBe(10); // 14.5
    expect(at(31, 2)).toBe(20); // 15.5
  });

  it('nearestGridIndex is monotone (property)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 17n }), fc.bigInt({ min: 0n, max: 10n ** 17n }), fc.bigInt({ min: 1n, max: 10n ** 6n }), (a, b, den) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(nearestGridIndex(SCALING_GRID, { num: lo, den })).toBeLessThanOrEqual(nearestGridIndex(SCALING_GRID, { num: hi, den }));
      }),
    );
  });

  it('floorGridIndex returns the largest value <= limit', () => {
    expect(BIG_BLIND_LADDER[floorGridIndex(BIG_BLIND_LADDER, 99)]).toBe(60);
    expect(BIG_BLIND_LADDER[floorGridIndex(BIG_BLIND_LADDER, 100)]).toBe(100);
    expect(floorGridIndex(BIG_BLIND_LADDER, 1)).toBe(-1);
  });
});

describe('generateBlindSchedule', () => {
  it('STANDARD at 10,000 chips is the spec example schedule', () => {
    const s = generateBlindSchedule({ startingStack: 10_000 });
    expect(s.map((l) => `${l.smallBlind}/${l.bigBlind}`)).toEqual([
      '50/100', '75/150', '100/200', '150/300', '200/400', '300/600', '500/1000', '750/1500', '1000/2000',
      '1500/3000', '2000/4000', '3000/6000', '5000/10000', '7500/15000', '10000/20000', '15000/30000',
      '20000/40000', '30000/60000', '50000/100000', '75000/150000',
    ]);
    expect(s.every((l) => l.durationSeconds === 480 && l.ante === 0)).toBe(true);
  });

  it('uses each preset parameter table', () => {
    for (const name of BLIND_PRESET_NAMES) {
      const p = BLIND_PRESETS[name];
      const s = generateBlindSchedule({ startingStack: 10_000, preset: name });
      expect(s).toHaveLength(p.levels);
      expect(s.every((l) => l.durationSeconds === p.levelDurationSeconds)).toBe(true);
    }
    expect(generateBlindSchedule({ startingStack: 10_000, preset: 'HYPER' })[0]!.bigBlind).toBe(200); // 50 BB
    expect(generateBlindSchedule({ startingStack: 10_000, preset: 'SPEED_TEST' })[0]!.bigBlind).toBe(400); // 25 BB
    expect(BLIND_PRESETS.SPEED_TEST.levelDurationSeconds).toBe(10);
    expect(BLIND_PRESETS.SPEED_TEST.timing.actionTimerSeconds).toBeLessThanOrEqual(2);
  });

  it('snaps the level-1 big blind to the nearest rung (ties up) and never above the stack', () => {
    expect(generateBlindSchedule({ startingStack: 25_000 })[0]!.bigBlind).toBe(300); // 250 is midway 200/300
    expect(generateBlindSchedule({ startingStack: 24_999 })[0]!.bigBlind).toBe(200);
    expect(generateBlindSchedule({ startingStack: 20_000 })[0]!.bigBlind).toBe(200);
    expect(generateBlindSchedule({ startingStack: 100 })[0]!.bigBlind).toBe(2); // clamp to the minimum rung
    expect(generateBlindSchedule({ startingStack: 2 })[0]).toEqual({ level: 1, smallBlind: 1, bigBlind: 2, ante: 0, durationSeconds: 480 });
    expect(generateBlindSchedule({ startingStack: 5, startingDepthBB: 1 })[0]!.bigBlind).toBe(4); // largest rung <= stack
  });

  it('applies options and ante rules', () => {
    const s = generateBlindSchedule({ startingStack: 10_000, levels: 5, levelDurationSeconds: 600, anteType: 'BB_ANTE', anteFromLevel: 3 });
    expect(s.map((l) => l.ante)).toEqual([0, 0, 200, 300, 400]);
    expect(s.every((l) => l.durationSeconds === 600)).toBe(true);
    const all = generateBlindSchedule({ startingStack: 10_000, levels: 4, anteType: 'ALL_PLAYERS' });
    expect(all.map((l) => l.ante)).toEqual([10, 15, 20, 30]);
    expect(generatedAnte('ALL_PLAYERS', 3)).toBe(1);
    expect(generatedAnte('NONE', 100)).toBe(0);
    expect(generateBlindSchedule({ startingStack: 10_000, startingDepthBB: 50 })[0]!.bigBlind).toBe(200);
  });

  it('stops at the top of the ladder instead of overflowing', () => {
    const s = generateBlindSchedule({ startingStack: Number.MAX_SAFE_INTEGER, levels: 500 });
    expect(s.length).toBeLessThan(500);
    expect(s[s.length - 1]!.bigBlind).toBe(6e15);
    expect(s.every((l) => Number.isSafeInteger(l.bigBlind))).toBe(true);
  });

  it('rejects invalid options with RangeError', () => {
    expect(() => generateBlindSchedule({ startingStack: 1 })).toThrow(RangeError);
    expect(() => generateBlindSchedule({ startingStack: 10.5 })).toThrow(RangeError);
    expect(() => generateBlindSchedule({ startingStack: 10_000, levels: 0 })).toThrow(RangeError);
    expect(() => generateBlindSchedule({ startingStack: 10_000, levels: 501 })).toThrow(RangeError);
    expect(() => generateBlindSchedule({ startingStack: 10_000, levelDurationSeconds: 0 })).toThrow(RangeError);
    expect(() => generateBlindSchedule({ startingStack: 10_000, startingDepthBB: 0 })).toThrow(RangeError);
    expect(() => generateBlindSchedule({ startingStack: 10_000, anteFromLevel: 0 })).toThrow(RangeError);
  });

  it('always yields a valid schedule whose level-1 big blind fits the stack (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 900_000_000 }),
        fc.constantFrom(...BLIND_PRESET_NAMES),
        fc.constantFrom('NONE' as const, 'BB_ANTE' as const, 'ALL_PLAYERS' as const),
        (startingStack, preset, anteType) => {
          const schedule = generateBlindSchedule({ startingStack, preset, anteType });
          expect(blindScheduleSchema.safeParse(schedule).success).toBe(true);
          expect(schedule[0]!.bigBlind).toBeLessThanOrEqual(startingStack);
          const cfg = defaultTournamentConfig({
            startingStack,
            maxPlayers: 1000,
            anteType,
            blindSchedule: schedule,
            breaks: presetBreaks(preset),
            timing: presetTiming(preset),
            speedMode: BLIND_PRESETS[preset].speedMode,
          });
          const result = validateTournamentConfig(cfg);
          if (!result.ok) throw new Error(result.error.message);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('is deterministic', () => {
    expect(generateBlindSchedule({ startingStack: 12_345, preset: 'TURBO' })).toEqual(generateBlindSchedule({ startingStack: 12_345, preset: 'TURBO' }));
  });
});

describe('scaleBlindSchedule', () => {
  const standard = generateBlindSchedule({ startingStack: 10_000 });

  it('doubling the stack doubles every blind exactly', () => {
    const scaled = scaleBlindSchedule(standard, 10_000, 20_000);
    expect(scaled.map((l) => [l.smallBlind, l.bigBlind])).toEqual(standard.map((l) => [l.smallBlind * 2, l.bigBlind * 2]));
  });

  it('identity when the stacks are equal (custom values kept)', () => {
    const custom: BlindLevel[] = [{ level: 1, smallBlind: 35, bigBlind: 70, ante: 7, durationSeconds: 300 }];
    const copy = scaleBlindSchedule(custom, 5000, 5000);
    expect(copy).toEqual(custom);
    expect(copy[0]).not.toBe(custom[0]);
  });

  it('snaps to the scaling grid with documented SB/ante rules', () => {
    const custom: BlindLevel[] = [
      { level: 1, smallBlind: 75, bigBlind: 150, ante: 150, durationSeconds: 300 },
      { level: 2, smallBlind: 100, bigBlind: 300, ante: 25, durationSeconds: 300 },
      { level: 3, smallBlind: 150, bigBlind: 300, ante: 0, durationSeconds: 300 },
    ];
    const scaled = scaleBlindSchedule(custom, 10_000, 15_000);
    // level 1: BB 225 → 250 (tie up); SB was half → 125; BB-ante follows the BB
    expect(scaled[0]).toEqual({ level: 1, smallBlind: 125, bigBlind: 250, ante: 250, durationSeconds: 300 });
    // level 2: BB 450 → 500 (tie up); SB 150 → 150 (grid); ante 37.5 → 40
    expect(scaled[1]).toEqual({ level: 2, smallBlind: 150, bigBlind: 500, ante: 40, durationSeconds: 300 });
    expect(scaled[2]).toEqual({ level: 3, smallBlind: 250, bigBlind: 500, ante: 0, durationSeconds: 300 });
  });

  it('never produces a zero blind when scaling far down', () => {
    const scaled = scaleBlindSchedule(standard, 10_000, 10);
    expect(scaled.every((l) => l.smallBlind >= 1 && l.bigBlind >= l.smallBlind)).toBe(true);
    expect(blindScheduleSchema.safeParse(scaled).success).toBe(true);
  });

  it('keeps any valid schedule valid (property)', () => {
    const scheduleArb = fc
      .array(fc.tuple(fc.integer({ min: 1, max: 10_000 }), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 0, max: 100 })), { minLength: 1, maxLength: 25 })
      .map((rows) => {
        let bb = 0;
        return rows.map(([step, sbPct, antePct], i): BlindLevel => {
          bb += step;
          return { level: i + 1, smallBlind: Math.max(1, Math.floor((bb * sbPct) / 100)), bigBlind: bb, ante: Math.floor((bb * antePct) / 100), durationSeconds: 300 };
        });
      });
    fc.assert(
      fc.property(scheduleArb, fc.integer({ min: 1, max: 10 ** 9 }), fc.integer({ min: 1, max: 10 ** 9 }), (schedule, from, to) => {
        const input = structuredClone(schedule);
        const scaled = scaleBlindSchedule(input, from, to);
        expect(input).toEqual(schedule); // not mutated
        expect(blindScheduleSchema.safeParse(scaled).success).toBe(true);
        expect(scaled.map((l) => l.level)).toEqual(schedule.map((l) => l.level));
        scaled.forEach((l, i) => {
          expect(l.ante === 0).toBe(schedule[i]!.ante === 0);
          expect(Number.isSafeInteger(l.ante)).toBe(true);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('rejects invalid stacks with RangeError', () => {
    expect(() => scaleBlindSchedule(standard, 0, 10)).toThrow(RangeError);
    expect(() => scaleBlindSchedule(standard, 10, 1.5)).toThrow(RangeError);
  });
});

describe('projections', () => {
  it('projects level start/end times including breaks between levels', () => {
    const schedule = generateBlindSchedule({ startingStack: 10_000, levels: 7 });
    const p = projectSchedule(schedule, [{ everyLevels: 6, durationSeconds: 600, message: 'Dinner' }]);
    expect(p.levels[0]).toMatchObject({ level: 1, startsAtSeconds: 0, endsAtSeconds: 480, breakAfter: null });
    expect(p.levels[5]).toMatchObject({ level: 6, startsAtSeconds: 2400, endsAtSeconds: 2880, breakAfter: { durationSeconds: 600, message: 'Dinner' } });
    expect(p.levels[6]).toMatchObject({ level: 7, startsAtSeconds: 3480, endsAtSeconds: 3960 });
    expect(p.totalSeconds).toBe(3960);
  });

  it('does not count a break after the final level', () => {
    const schedule = generateBlindSchedule({ startingStack: 10_000, levels: 2 });
    expect(projectSchedule(schedule, [{ afterLevel: 2, durationSeconds: 600 }]).totalSeconds).toBe(960);
    expect(projectSchedule([], []).totalSeconds).toBe(0);
  });

  it('computes the starting depth in big blinds', () => {
    expect(startingDepthInBigBlinds(10_000, generateBlindSchedule({ startingStack: 10_000 }))).toBe(100);
    expect(startingDepthInBigBlinds(10_000, [])).toBeNull();
  });
});
