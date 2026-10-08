import { describe, expect, it } from 'vitest';
import {
  aggressiveKind,
  canSize,
  clampTo,
  intentForAmount,
  isCallAllIn,
  lastActionLabel,
  passiveLabel,
  raisePresets,
  sizedActionLabel,
  snapTo,
} from '../src/actionLogic';
import { legal } from './fixtures';

describe('labels', () => {
  it('check vs call', () => {
    expect(passiveLabel(legal({ canCheck: true }))).toBe('CHECK');
    expect(passiveLabel(legal({ canCall: true, callAmount: 500 }))).toBe('CALL 500');
    expect(passiveLabel(legal({ canCall: true, callAmount: 12_450 }))).toBe('CALL 12,450');
    expect(passiveLabel(legal())).toBeNull();
  });
  it('bet vs raise', () => {
    expect(aggressiveKind(legal({ canBet: true }))).toBe('BET');
    expect(aggressiveKind(legal({ canRaise: true }))).toBe('RAISE');
    expect(aggressiveKind(legal())).toBeNull();
  });
  it('call all-in detection', () => {
    expect(isCallAllIn(legal({ canCall: true, callAmount: 3000, stack: 3000 }))).toBe(true);
    expect(isCallAllIn(legal({ canCall: true, callAmount: 300, stack: 3000 }))).toBe(false);
  });
  it('sized labels', () => {
    const l = legal({ canRaise: true, minTo: 1000, maxTo: 10_000, canAllIn: true, allInTo: 10_000 });
    expect(sizedActionLabel(l, 1500)).toBe('RAISE TO 1,500');
    expect(sizedActionLabel(l, 10_000)).toBe('ALL-IN 10,000');
    expect(sizedActionLabel(legal({ canBet: true, minTo: 200, maxTo: 900 }), 600)).toBe('BET 600');
  });
  it('last action labels', () => {
    expect(lastActionLabel('CALL', 1200, 1000)).toBe('CALL 1,000');
    expect(lastActionLabel('RAISE', 2400, 2200)).toBe('RAISE TO 2,400');
    expect(lastActionLabel('BET', 600, 600)).toBe('BET 600');
    expect(lastActionLabel('ALL_IN', 8000, 7000)).toBe('ALL-IN 8,000');
    expect(lastActionLabel('FOLD', 0, 0)).toBe('FOLD');
    expect(lastActionLabel('CHECK', 0, 0)).toBe('CHECK');
  });
});

describe('raisePresets', () => {
  it('facing a bet uses multiples of the current bet, clamped', () => {
    const l = legal({ canRaise: true, currentBet: 500, minTo: 1000, maxTo: 10_000, canAllIn: true, allInTo: 10_000 });
    const p = raisePresets(l, 200);
    expect(p.map((x) => [x.id, x.to])).toEqual([
      ['min', 1000],
      ['2x', 1000],
      ['2.5x', 1250],
      ['3x', 1500],
      ['allin', 10_000],
    ]);
    expect(p.find((x) => x.id === '2x')?.clamped).toBe(false);
  });
  it('unopened uses multiples of the big blind', () => {
    const l = legal({ canBet: true, currentBet: 0, minTo: 200, maxTo: 10_000, canAllIn: true, allInTo: 10_000 });
    expect(raisePresets(l, 200).map((x) => x.to)).toEqual([200, 400, 500, 600, 10_000]);
  });
  it('clamps presets below min up to min and above max down to max', () => {
    const l = legal({ canRaise: true, currentBet: 1000, minTo: 2500, maxTo: 2800, canAllIn: true, allInTo: 2800 });
    const p = raisePresets(l, 200);
    expect(p.map((x) => x.to)).toEqual([2500, 2500, 2500, 2800, 2800]);
    expect(p.find((x) => x.id === '2x')?.clamped).toBe(true);
    expect(p.find((x) => x.id === '3x')?.clamped).toBe(true);
    for (const x of p) {
      expect(x.to).toBeGreaterThanOrEqual(l.minTo);
      expect(x.to).toBeLessThanOrEqual(l.maxTo);
    }
  });
  it('rounds 2.5x to an integer', () => {
    const l = legal({ canRaise: true, currentBet: 333, minTo: 666, maxTo: 5000 });
    expect(raisePresets(l, 100).find((x) => x.id === '2.5x')?.to).toBe(833);
  });
});

describe('clamp, snap and intent', () => {
  const l = legal({ canRaise: true, currentBet: 500, minTo: 1000, maxTo: 9_999, canAllIn: true, allInTo: 9_999 });
  it('clampTo', () => {
    expect(clampTo(5, l)).toBe(1000);
    expect(clampTo(50_000, l)).toBe(9_999);
    expect(clampTo(1234.6, l)).toBe(1235);
    expect(clampTo(Number.NaN, l)).toBe(1000);
  });
  it('snapTo keeps min and max reachable', () => {
    expect(snapTo(1010, l, 100)).toBe(1000);
    expect(snapTo(9_960, l, 100)).toBe(9_999);
    expect(snapTo(4_449, l, 100)).toBe(4_400);
    expect(snapTo(4_451, l, 100)).toBe(4_500);
  });
  it('intentForAmount sends RAISE/BET "to" totals and ALL_IN at max', () => {
    expect(intentForAmount(l, 2000)).toEqual({ type: 'RAISE', amount: 2000 });
    expect(intentForAmount(l, 50)).toEqual({ type: 'RAISE', amount: 1000 });
    expect(intentForAmount(l, 9_999)).toEqual({ type: 'ALL_IN' });
    const bet = legal({ canBet: true, minTo: 200, maxTo: 5000, canAllIn: true, allInTo: 5000 });
    expect(intentForAmount(bet, 600)).toEqual({ type: 'BET', amount: 600 });
  });
  it('canSize only when there is a range', () => {
    expect(canSize(l)).toBe(true);
    expect(canSize(legal({ canRaise: true, minTo: 2000, maxTo: 2000 }))).toBe(false);
    expect(canSize(legal())).toBe(false);
  });
});
