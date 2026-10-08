import { describe, expect, it } from 'vitest';
import { checkRunningConfigEdit, defaultTournamentConfig, jsonEqual } from '../src';
import { expectIssue, expectOk, issuePaths } from './fixtures';

const before = defaultTournamentConfig({ lateRegistration: { enabled: true, untilLevel: 4 } });

describe('checkRunningConfigEdit', () => {
  it('accepts an unchanged config', () => {
    expect(expectOk(checkRunningConfigEdit(before, structuredClone(before), { currentLevel: 5 }))).toEqual(before);
  });

  it('allows future levels, breaks, action timers, spectators and features to change', () => {
    const after = structuredClone(before);
    after.blindSchedule[5]!.durationSeconds = 900;
    after.blindSchedule.push({ level: 21, smallBlind: 100_000, bigBlind: 200_000, ante: 0, durationSeconds: 480 });
    after.breaks = [{ afterLevel: 8, durationSeconds: 900, message: 'Dinner' }];
    after.timing.actionTimerSeconds = 20;
    after.timing.awayActionTimerSeconds = 8;
    after.spectators.delaySeconds = 30;
    after.features.soundEffects = false;
    expect(checkRunningConfigEdit(before, after, { currentLevel: 5 }).ok).toBe(true);
  });

  it('allows removing future levels but never played ones', () => {
    const shorter = { ...structuredClone(before), blindSchedule: before.blindSchedule.slice(0, 6), breaks: [] };
    expect(checkRunningConfigEdit(before, shorter, { currentLevel: 6 }).ok).toBe(true);
    const tooShort = { ...shorter, blindSchedule: before.blindSchedule.slice(0, 5) };
    expectIssue(checkRunningConfigEdit(before, tooShort, { currentLevel: 6 }), 'blindSchedule', 'already been played');
  });

  it('locks the current and past levels', () => {
    const after = structuredClone(before);
    after.blindSchedule[4]!.durationSeconds = 900; // level 5 = current
    after.blindSchedule[0]!.durationSeconds = 600;
    const result = checkRunningConfigEdit(before, after, { currentLevel: 5 });
    expect(issuePaths(result)).toEqual(['blindSchedule[0]', 'blindSchedule[4]']);
  });

  it('locks every other setting', () => {
    const after = structuredClone(before);
    after.startingStack = 20_000;
    after.timing.betweenHandsDelayMs = 500;
    after.tables.maxSize = 10;
    after.name = 'Renamed';
    after.prizeStructure.places[0]!.amountMinor = 900_000;
    const result = checkRunningConfigEdit(before, after, { currentLevel: 1 });
    expect(issuePaths(result)).toEqual(['name', 'tables', 'startingStack', 'timing.betweenHandsDelayMs', 'prizeStructure']);
    expectIssue(result, 'name', 'locked');
  });

  it('still requires the new config to be valid', () => {
    const after = { ...structuredClone(before), timing: { ...before.timing, actionTimerSeconds: 1, awayActionTimerSeconds: 1 } };
    expectIssue(checkRunningConfigEdit(before, after, { currentLevel: 3 }), 'timing.actionTimerSeconds', 'speed mode');
    expect(checkRunningConfigEdit(before, 'nope', { currentLevel: 3 }).ok).toBe(false);
    const cut = { ...structuredClone(before), blindSchedule: before.blindSchedule.slice(0, 3), breaks: [] };
    expectIssue(checkRunningConfigEdit(before, cut, { currentLevel: 1 }), 'lateRegistration.untilLevel');
  });

  it('treats currentLevel 0 as "nothing played yet"', () => {
    const after = structuredClone(before);
    after.blindSchedule[0]!.durationSeconds = 600;
    expect(checkRunningConfigEdit(before, after, { currentLevel: 0 }).ok).toBe(true);
  });

  it('rejects an invalid currentLevel as a programmer error', () => {
    expect(() => checkRunningConfigEdit(before, before, { currentLevel: -1 })).toThrow(RangeError);
    expect(() => checkRunningConfigEdit(before, before, { currentLevel: 1.5 })).toThrow(RangeError);
  });

  it('does not mutate its inputs', () => {
    const b = structuredClone(before);
    const a = structuredClone(before);
    a.timing.actionTimerSeconds = 30;
    const aCopy = structuredClone(a);
    checkRunningConfigEdit(b, a, { currentLevel: 2 });
    expect(b).toEqual(before);
    expect(a).toEqual(aCopy);
  });
});

describe('jsonEqual', () => {
  it('compares plain JSON data deeply, ignoring key order and undefined values', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: '1' })).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
  });
});
