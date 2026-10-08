import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkTableInvariants, reduceTable } from '../src';
import type { TableState } from '../src';
import type { TableEvent } from '@jpb/shared-types';
import { seededContext } from './helpers';
import { assertEventPrivacy, simulate } from './sim';

function replay(initial: TableState, h: ReturnType<typeof simulate>['h'], from = 0, start: TableState = initial) {
  let state = start;
  const events: TableEvent[] = [];
  for (const env of h.envelopes.slice(from)) {
    const t = reduceTable(state, env, h.ctx);
    state = t.state;
    events.push(...t.events);
  }
  return { state, events };
}

describe('replay determinism', () => {
  it('250 hands with random actions, timeouts, disconnects and seat changes replay to the identical state and event stream', () => {
    const { h, steps } = simulate({ seed: 20_241, hands: 250, maxSeats: 9 });
    expect(h.state.counters.handsPlayed).toBeGreaterThanOrEqual(250);
    expect(steps).toBeGreaterThan(250);
    // the run exercised the interesting paths
    const kinds = new Set(h.events.map((e) => e.event.kind));
    for (const k of [
      'PLAYER_REMOVED',
      'PLAYER_SEATED',
      'SHOWDOWN',
      'UNCALLED_BET_RETURNED',
      'STACK_ADJUSTED',
      'BLINDS_SCHEDULED',
      'PLAYER_CONNECTION_CHANGED',
    ]) {
      expect(kinds.has(k as never), `run never produced ${k}`).toBe(true);
    }
    expect(h.payloads('PLAYER_ACTED').some((e) => e.timeout)).toBe(true);
    expect(h.payloads('PLAYER_REMOVED').some((e) => e.reason === 'ELIMINATED')).toBe(true);

    const full = replay(h.initial, h);
    expect(full.state).toEqual(h.state);
    expect(full.events).toEqual(h.events);

    // Snapshot (JSON round trip) half-way, then replay the rest.
    const mid = Math.floor(h.envelopes.length / 2);
    const firstHalf = replay(h.initial, { ...h, envelopes: h.envelopes.slice(0, mid) } as typeof h);
    const snapshot = JSON.parse(JSON.stringify(firstHalf.state)) as TableState;
    expect(snapshot).toEqual(firstHalf.state);
    const rest = replay(h.initial, h, mid, snapshot);
    expect(rest.state).toEqual(h.state);
    expect([...firstHalf.events, ...rest.events]).toEqual(h.events);

    // Event stream: gap-free seqs, versions non-decreasing, privacy.
    h.events.forEach((e, i) => expect(e.seq).toBe(i + 1));
    for (let i = 1; i < h.events.length; i += 1)
      expect(h.events[i]?.version).toBeGreaterThanOrEqual(h.events[i - 1]?.version as number);
    assertEventPrivacy(h.events);
    expect(JSON.parse(JSON.stringify(h.state))).toEqual(h.state);
  });

  it('a different deck seed gives a different game (sanity: the deck provider is really used)', () => {
    const a = simulate({ seed: 7, hands: 5, maxSeats: 4 });
    const other = replay(a.h.initial, { ...a.h, ctx: seededContext('another-seed') } as typeof a.h);
    expect(other.events).not.toEqual(a.h.events);
  });

  it('property: random tables (2-10 seats) keep invariants, conserve chips, never leak cards and replay exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const { h } = simulate({ seed, hands: 25, checkViews: true });
        expect(h.state.counters.handsPlayed).toBeGreaterThanOrEqual(25);
        expect(checkTableInvariants(h.state)).toEqual([]);
        assertEventPrivacy(h.events);
        const r = replay(h.initial, h);
        expect(r.state).toEqual(h.state);
        expect(r.events).toEqual(h.events);
      }),
      { numRuns: 12 },
    );
  }, 120_000);
});
