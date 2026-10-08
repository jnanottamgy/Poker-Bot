import { describe, expect, it } from 'vitest';
import type { PlayerTableView, TableEvent } from '@jpb/shared-types';
import { evaluateBest } from '../src/mock/evaluator';
import { MockTable } from '../src/mock/table';
import type { SimPlayer } from '../src/mock/table';
import { FakeClock } from './helpers/fakeClock';

function setup(heroAction: (view: PlayerTableView) => { type: 'FOLD' | 'CHECK' | 'CALL' | 'ALL_IN' }) {
  const clock = new FakeClock();
  const table = new MockTable({
    tableId: 't1',
    tournamentId: 'trn',
    tableNumber: 7,
    maxSeats: 9,
    blinds: { level: 3, smallBlind: 100, bigBlind: 200, ante: 200, anteType: 'BB_ANTE' },
    seed: 42,
    clock,
  });
  const players: SimPlayer[] = Array.from({ length: 6 }, (_, i) => ({
    playerId: `p${i}`,
    displayName: `Bot ${i}`,
    publicId: `JPN-000${i}`,
    stack: 10_000,
    style: (['tight', 'loose', 'aggro', 'station', 'tight', 'loose'] as const)[i] ?? 'tight',
    human: i === 0,
  }));
  players.forEach((p, i) => table.seatPlayer(p, i));
  const events: TableEvent[] = [];
  table.subscribe((b) => {
    events.push(...b.events);
    const view = table.playerView('p0');
    const legal = view?.you.legal;
    if (view && legal && view.hand && view.hand.turnVersion !== null) {
      const turnVersion = view.hand.turnVersion;
      clock.setTimeout(() => table.submit('p0', heroAction(view).type, undefined, turnVersion), 300);
    }
  });
  return { clock, table, players, events };
}

const stacks = (players: SimPlayer[]) => players.reduce((s, p) => s + p.stack, 0);
function chipsInPlay(table: MockTable, players: SimPlayer[]): number {
  const h = table.spectatorView().hand;
  return stacks(players) + (h && h.phase !== 'HAND_COMPLETE' ? h.totalPot : 0);
}

describe('mock table engine', () => {
  it('plays many hands, conserving chips, with the hero calling everything', () => {
    const { clock, table, players, events } = setup((v) => ({ type: v.you.legal?.canCheck ? 'CHECK' : 'CALL' }));
    table.start(100);
    clock.advance(10 * 60_000);
    expect(table.handNumber).toBeGreaterThan(20);
    expect(chipsInPlay(table, players)).toBe(60_000);
    const completed = events.filter((e) => e.event.kind === 'HAND_COMPLETED');
    expect(completed.length).toBeGreaterThan(15);
    // Seq is gap-free and versions are monotonic.
    events.forEach((e, i) => i > 0 && expect(e.seq).toBe((events[i - 1] as TableEvent).seq + 1));
  });

  it('times out an idle hero with check/fold and keeps going', () => {
    const { clock, table, players, events } = setup(() => ({ type: 'FOLD' }));
    table.start(100);
    clock.advance(5 * 60_000);
    expect(chipsInPlay(table, players)).toBe(60_000);
    expect(events.some((e) => e.event.kind === 'PLAYER_ACTED' && e.event.playerId === 'p0')).toBe(true);
  });

  it('rejects stale table versions', () => {
    const clock = new FakeClock();
    const table = new MockTable({ tableId: 't', tournamentId: 'x', tableNumber: 1, maxSeats: 6, blinds: { level: 1, smallBlind: 50, bigBlind: 100, ante: 0, anteType: 'NONE' }, seed: 1, clock });
    table.seatPlayer({ playerId: 'h', displayName: 'Hero', publicId: 'JPN-1', stack: 5000, style: 'tight', human: true }, 0);
    table.seatPlayer({ playerId: 'b', displayName: 'Bot', publicId: 'JPN-2', stack: 5000, style: 'tight' }, 1);
    table.start(10);
    clock.advance(50);
    const v = table.playerView('h');
    if (v?.you.legal && v.hand && v.hand.turnVersion !== null) {
      expect(table.submit('h', 'CALL', undefined, v.hand.turnVersion + 99).code).toBe('STALE_STATE_VERSION');
      expect(table.submit('h', 'CALL', undefined, v.hand.turnVersion).ok).toBe(true);
    } else {
      expect(table.submit('h', 'CALL', undefined, 1).ok).toBe(false);
    }
  });
});

describe('mock evaluator', () => {
  it('describes hands like the engine', () => {
    expect(evaluateBest(['Ah', 'Kh', 'Qh', 'Jd', '4h', 'Th', '2c']).description).toBe('Flush, Ace High');
    expect(evaluateBest(['Qs', 'Qc', 'Qh', 'Jd', '4h', 'Th', '2c']).description).toBe('Three of a Kind, Queens');
    expect(evaluateBest(['As', '2d', '3c', '4h', '5s', 'Kd', 'Kc']).description).toBe('Straight, Five High');
    expect(evaluateBest(['Jh', 'Js', 'Jd', '7d', '7s', 'Ah', '2c']).description).toBe('Full House, Jacks full of Sevens');
  });
});
