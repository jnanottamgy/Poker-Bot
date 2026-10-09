import { describe, expect, it } from 'vitest';
import { betPosition, clockView, formatBB, seatPositions, tournamentStats } from '../src/model/derive';
import { blindsText, finishText, splashFor, tickerItemFor } from '../src/model/events';
import { INITIAL_DISPLAY_STATE } from '../src/model/reducer';
import { parseParams } from '../src/params';
import { elimination, summary } from './fixtures';

describe('clock view', () => {
  it('counts down a running level against server time', () => {
    const c = clockView(summary(), 1_450_000);
    expect(c).toMatchObject({ mode: 'LEVEL', remainingMs: 450_000, totalMs: 900_000 });
    expect(c.progress).toBeCloseTo(0.5);
    expect(clockView(summary(), 2_000_000).remainingMs).toBe(0);
  });

  it('shows the stopped time while paused and the break countdown on break', () => {
    const paused = summary({ clock: { ...summary().clock, levelEndsAt: null, pausedRemainingMs: 123_000 } }, 'PAUSED');
    expect(clockView(paused, 9_999_999)).toMatchObject({ mode: 'PAUSED', remainingMs: 123_000 });
    const onBreak = summary({ clock: { ...summary().clock, levelEndsAt: null, breakEndsAt: 1_300_000 } }, 'BREAK');
    expect(clockView(onBreak, 1_000_000)).toMatchObject({ mode: 'BREAK', remainingMs: 300_000 });
    expect(clockView(null, 0).mode).toBe('IDLE');
  });
});

describe('stats', () => {
  it('average stack = chips in play / players remaining, in big blinds too', () => {
    const s = tournamentStats({ ...INITIAL_DISPLAY_STATE, tournament: summary(), info: { name: 'x', joinCode: 'ABCD', currency: 'INR', places: [{ position: 1, amountMinor: 700 }, { position: 2, amountMinor: 300 }], startingStack: 20_000 } });
    expect(s).toMatchObject({ remaining: 20, registered: 40, tables: 3, averageStack: 40_000, prizePoolMinor: 1_000, paidPlaces: 2 });
    expect(s.averageBB).toBeCloseTo(40_000 / 600);
    expect(formatBB(66.7)).toBe('67 BB');
    expect(formatBB(7.25)).toBe('7.3 BB');
    expect(formatBB(null)).toBe('—');
  });
});

describe('seat geometry', () => {
  it('seat 0 sits at the bottom centre and seats go clockwise around the oval', () => {
    const p = seatPositions(9);
    expect(p).toHaveLength(9);
    expect(p[0]).toEqual({ x: 50, y: 91 });
    expect(p[1]!.x).toBeLessThan(50); // clockwise on screen: bottom -> left
    for (const q of p) {
      expect(q.x).toBeGreaterThanOrEqual(0);
      expect(q.x).toBeLessThanOrEqual(100);
      expect(q.y).toBeGreaterThanOrEqual(0);
      expect(q.y).toBeLessThanOrEqual(100);
    }
    const b = betPosition(p[0]!);
    expect(b.x).toBe(50);
    expect(b.y).toBeLessThan(91);
    expect(b.y).toBeGreaterThan(50);
  });
});

describe('broadcast copy', () => {
  it('is a fixed template of the event', () => {
    expect(blindsText({ smallBlind: 1000, bigBlind: 2000, ante: 0 })).toBe('1,000 / 2,000');
    expect(blindsText({ smallBlind: 1000, bigBlind: 2000, ante: 300 })).toBe('1,000 / 2,000 · ante 300');
    expect(finishText('Kai', 3, 1)).toBe('Kai finishes in 3rd place');
    expect(finishText('Kai', 3, 2)).toBe('Kai finishes in 3rd place (tied)');
    const env = { tournamentId: 't', seq: 4, at: 9, event: elimination(12, 11, 'Kai') };
    expect(tickerItemFor(env)).toEqual({ id: 't4', at: 9, tone: 'elim', text: 'Kai finishes in 12th place · 11 remain' });
    expect(tickerItemFor({ ...env, event: { kind: 'COUNTERS', counters: summary().counters } })).toBeNull();
    expect(splashFor({ ...env, event: elimination(40, 39) }, 1, 0)).toBeNull();
    expect(splashFor({ ...env, event: elimination(40, 39) }, 1, 45)).not.toBeNull(); // inside the money
    expect(splashFor({ ...env, event: { kind: 'MILESTONE', code: 'IN_THE_MONEY', text: 'IN THE MONEY — 6 PLAYERS PAID', playersRemaining: 6 } }, 1, 6)?.title).toBe('In The Money — 6 Players Paid');
  });
});

describe('page parameters', () => {
  it('accepts ?t=, ?code= and /display/<code>, demo presets and a pinned scene', () => {
    expect(parseParams('?t=trn_abc', '/display/')).toMatchObject({ tournamentId: 'trn_abc', joinCode: null, demo: false });
    expect(parseParams('?code=ab12cd', '/display/')).toMatchObject({ joinCode: 'AB12CD' });
    expect(parseParams('', '/display/XY12ZZ')).toMatchObject({ joinCode: 'XY12ZZ' });
    expect(parseParams('', '/display/index.html').joinCode).toBeNull();
    expect(parseParams('?demo=1&preset=final&scene=leaderboard', '/display/')).toMatchObject({ demo: true, preset: 'final', pinnedScene: 'LEADERBOARD' });
    expect(parseParams('?demo=1&preset=nope&scene=nope', '/display/')).toMatchObject({ preset: 'running', pinnedScene: null });
    expect(parseParams('?t=bad%20id', '/display/').tournamentId).toBeNull();
  });
});
