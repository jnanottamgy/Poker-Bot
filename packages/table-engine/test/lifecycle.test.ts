import { describe, expect, it } from 'vitest';
import { createTable, createTableState } from '../src';
import { BLINDS, Harness, T0, TIMING, ZERO_STATS } from './helpers';

function threeHanded(): Harness {
  const h = new Harness({ initialButtonSeat: 0 });
  h.seat('a', 0);
  h.seat('b', 3);
  h.seat('c', 6);
  return h;
}

describe('creation', () => {
  it('starts WAITING, empty, version 0, no events; createTable adds TABLE_CREATED as seq 1', () => {
    const input = {
      tableId: 'T9',
      tournamentId: 'X',
      tableNumber: 9,
      maxSeats: 6,
      timing: TIMING,
      blinds: BLINDS,
      initialButtonSeat: 2,
      createdAt: T0,
    };
    const s = createTableState(input);
    expect(s).toMatchObject({
      status: 'WAITING',
      version: 0,
      nextEventSeq: 1,
      handNumber: 0,
      buttonSeat: 2,
      started: false,
    });
    expect(s.seats).toEqual([null, null, null, null, null, null]);
    const { state, events } = createTable(input);
    expect(events).toEqual([
      {
        tableId: 'T9',
        tournamentId: 'X',
        seq: 1,
        version: 0,
        at: T0,
        visibility: 'PUBLIC',
        privateTo: null,
        event: { kind: 'TABLE_CREATED', tableNumber: 9, maxSeats: 6 },
      },
    ]);
    expect(state.nextEventSeq).toBe(2);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('throws RangeError on invalid host input', () => {
    const ok = {
      tableId: 'T',
      tournamentId: 'X',
      tableNumber: 1,
      maxSeats: 9,
      timing: TIMING,
      blinds: BLINDS,
      initialButtonSeat: null,
      createdAt: T0,
    };
    expect(() => createTableState({ ...ok, maxSeats: 1 })).toThrow(RangeError);
    expect(() => createTableState({ ...ok, maxSeats: 11 })).toThrow(RangeError);
    expect(() => createTableState({ ...ok, initialButtonSeat: 9 })).toThrow(RangeError);
    expect(() => createTableState({ ...ok, blinds: { ...BLINDS, smallBlind: 200 } })).toThrow(RangeError);
    expect(() => createTableState({ ...ok, timing: { ...TIMING, actionTimerMs: 0 } })).toThrow(RangeError);
    expect(() => createTableState({ ...ok, tableId: '' })).toThrow(RangeError);
  });
});

describe('seating and START', () => {
  it('validates SEAT_PLAYER', () => {
    const h = new Harness({ maxSeats: 6 });
    const base = {
      type: 'SEAT_PLAYER' as const,
      playerId: 'p',
      displayName: 'P',
      publicId: 'JPN-P',
      seat: 0,
      stack: 100,
      stats: ZERO_STATS,
      moveId: null,
    };
    expect(h.send({ ...base, seat: 6 }).reply?.code).toBe('SEAT_UNAVAILABLE');
    expect(h.send({ ...base, seat: -1 }).reply?.code).toBe('SEAT_UNAVAILABLE');
    expect(h.send({ ...base, stack: 0 }).reply?.code).toBe('INVALID_COMMAND');
    expect(h.send({ ...base, stack: 1.5 }).reply?.code).toBe('INVALID_COMMAND');
    expect(h.send({ ...base, playerId: '' }).reply?.code).toBe('INVALID_COMMAND');
    expect(h.send({ ...base, stats: { ...ZERO_STATS, handsPlayedTotal: -1 } }).reply?.code).toBe('INVALID_COMMAND');
    expect(h.send({ ...base, moveId: 5 as never }).reply?.code).toBe('INVALID_COMMAND');
    expect(h.send(base).reply?.ok).toBe(true);
    expect(h.send({ ...base, playerId: 'q' }).reply?.code).toBe('SEAT_UNAVAILABLE');
    expect(h.send({ ...base, seat: 1 }).reply?.code).toBe('PLAYER_ALREADY_SEATED');
    expect(h.lastPayloads()).toEqual([]);
    expect(h.payloads('PLAYER_SEATED')).toEqual([
      { kind: 'PLAYER_SEATED', seat: 0, playerId: 'p', displayName: 'P', publicId: 'JPN-P', stack: 100, moveId: null },
    ]);
    expect(h.send({ ...base, playerId: 'z', seat: 2, connected: false }).reply?.ok).toBe(true);
    expect(h.occupant('z')?.connected).toBe(false);
  });

  it('START with fewer than two players waits; the second arrival schedules NEXT_HAND', () => {
    const h = new Harness();
    h.seat('a', 0);
    h.start();
    expect(h.state.status).toBe('WAITING');
    expect(h.start().reply?.message).toBe('already started');
    h.seat('b', 4);
    expect(h.state.status).toBe('BETWEEN_HANDS');
    expect(h.state.nextHand?.dueAt).toBe(h.now + TIMING.betweenHandsDelayMs);
    expect(h.lastPayloads().map((e) => e.kind)).toEqual(['PLAYER_SEATED', 'TABLE_STATUS_CHANGED']);
    h.fireNextHand();
    expect(h.state.status).toBe('IN_HAND');
  });

  it('players do not deal before START', () => {
    const h = new Harness();
    h.seat('a', 0);
    h.seat('b', 1);
    expect(h.state.status).toBe('WAITING');
    expect(h.state.nextHand).toBeNull();
  });

  it('removal leaving one player cancels the pending NEXT_HAND (its token becomes stale)', () => {
    const h = threeHanded();
    h.start();
    h.foldAround();
    const token = h.state.nextHand?.token as string;
    h.send({ type: 'REMOVE_PLAYER', playerId: 'a', reason: 'ADMIN', moveId: null });
    h.send({ type: 'REMOVE_PLAYER', playerId: 'b', reason: 'ADMIN', moveId: null });
    expect(h.state.status).toBe('WAITING');
    expect(h.send({ type: 'TIMER_FIRED', kind: 'NEXT_HAND', token }, h.now + 60_000).events).toEqual([]);
  });
});

describe('removal', () => {
  it('pending removal is applied right after the hand with the exact stack', () => {
    const h = threeHanded();
    h.start(); // button 0 (a) acts first, SB 3 (b), BB 6 (c)
    h.act({ type: 'RAISE', amount: 400 }); // a
    expect(h.send({ type: 'REMOVE_PLAYER', playerId: 'b', reason: 'MOVED', moveId: 'M7' }).reply).toMatchObject({
      ok: true,
      message: 'removal pending until the hand completes',
    });
    expect(h.lastPayloads()).toEqual([]);
    expect(h.occupant('b')?.pendingRemoval).toEqual({ reason: 'MOVED', moveId: 'M7' });
    h.act({ type: 'CALL' }); // b still plays the hand
    h.act({ type: 'FOLD' }); // c
    while (h.state.turn !== null) h.act({ type: 'CHECK' });
    const res = h.payloads('HAND_RESULT')[0]?.result;
    const bFinal = res?.players.find((p) => p.playerId === 'b')?.finalStack;
    const kinds = h.last?.events.map((e) => e.event.kind) ?? [];
    expect(kinds.slice(kinds.indexOf('HAND_COMPLETED'))).toEqual([
      'HAND_COMPLETED',
      'HAND_RESULT',
      'PLAYER_REMOVED',
      'TABLE_STATUS_CHANGED',
    ]);
    expect(h.payloads('PLAYER_REMOVED')[0]).toMatchObject({
      playerId: 'b',
      reason: 'MOVED',
      moveId: 'M7',
      seat: 3,
      stack: bFinal,
    });
    expect(h.occupant('b')).toBeNull();
    expect(res?.totalChipsAtTable).toBe(30_000);
  });

  it('a busted player with a pending move is removed as ELIMINATED', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('w', 0, 5_000);
    h.seat('l', 1, 1_000);
    h.seat('x', 2, 5_000);
    h.rigNextHand({ 0: ['As', 'Ah'], 1: ['7c', '2d'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    h.start();
    h.send({ type: 'REMOVE_PLAYER', playerId: 'l', reason: 'MOVED', moveId: 'M1' });
    h.playAllInHand('l', 'w');
    expect(h.payloads('PLAYER_REMOVED')).toEqual([
      expect.objectContaining({ playerId: 'l', reason: 'ELIMINATED', stack: 0, moveId: null }),
    ]);
  });

  it('removing a player who is waiting for the next hand is immediate', () => {
    const h = threeHanded();
    h.start();
    h.seat('late', 8, 777);
    const t = h.send({ type: 'REMOVE_PLAYER', playerId: 'late', reason: 'MOVED', moveId: 'M2' });
    expect(t.events.map((e) => e.event)).toEqual([
      {
        kind: 'PLAYER_REMOVED',
        seat: 8,
        playerId: 'late',
        reason: 'MOVED',
        stack: 777,
        moveId: 'M2',
        stats: ZERO_STATS,
      },
    ]);
  });

  it('rejects unknown players and bad reasons', () => {
    const h = threeHanded();
    expect(h.send({ type: 'REMOVE_PLAYER', playerId: 'nobody', reason: 'ADMIN', moveId: null }).reply?.code).toBe(
      'PLAYER_NOT_SEATED',
    );
    expect(h.send({ type: 'REMOVE_PLAYER', playerId: 'a', reason: 'BORED' as never, moveId: null }).reply?.code).toBe(
      'INVALID_COMMAND',
    );
  });
});

describe('holds', () => {
  it('a hold during a hand takes effect after it; RELEASE of the last hold schedules NEXT_HAND', () => {
    const h = threeHanded();
    h.start();
    h.send({ type: 'HOLD', reason: 'BREAK' });
    expect(h.state.status).toBe('IN_HAND');
    expect(h.lastPayloads()).toEqual([
      { kind: 'TABLE_STATUS_CHANGED', status: 'IN_HAND', holds: ['BREAK'], frozen: false },
    ]);
    h.foldAround();
    expect(h.state.status).toBe('HELD');
    expect(h.state.nextHand).toBeNull();
    expect(h.last?.timers).toEqual([]);
    h.send({ type: 'HOLD', reason: 'PAUSE' });
    h.send({ type: 'RELEASE', reason: 'BREAK' });
    expect(h.state.status).toBe('HELD');
    const t = h.send({ type: 'RELEASE', reason: 'PAUSE' });
    expect(h.state.status).toBe('BETWEEN_HANDS');
    expect(t.timers).toEqual([
      { kind: 'NEXT_HAND', at: h.now + TIMING.betweenHandsDelayMs, token: h.state.nextHand?.token },
    ]);
    expect(h.send({ type: 'RELEASE', reason: 'PAUSE' }).reply?.message).toBe('not held for this reason');
    expect(h.send({ type: 'HOLD', reason: 'NAP' as never }).reply?.code).toBe('INVALID_COMMAND');
  });

  it('a hold between hands cancels the pending NEXT_HAND (stale token)', () => {
    const h = threeHanded();
    h.start();
    h.foldAround();
    const token = h.state.nextHand?.token as string;
    h.send({ type: 'HOLD', reason: 'CONSOLIDATION' });
    expect(h.state.status).toBe('HELD');
    expect(h.send({ type: 'TIMER_FIRED', kind: 'NEXT_HAND', token }, h.now + 99_000).events).toEqual([]);
  });

  it('a hold before START keeps the table HELD after START', () => {
    const h = threeHanded();
    h.send({ type: 'HOLD', reason: 'FINAL_TABLE' });
    expect(h.state.status).toBe('HELD');
    h.start();
    expect(h.state.status).toBe('HELD');
    h.send({ type: 'RELEASE', reason: 'FINAL_TABLE' });
    expect(h.state.status).toBe('BETWEEN_HANDS');
  });
});

describe('hand-for-hand', () => {
  it('holds automatically after every hand until released', () => {
    const h = threeHanded();
    h.start();
    h.send({ type: 'SET_HAND_FOR_HAND', enabled: true });
    expect(h.state.holds).toEqual([]); // the running hand completes first
    h.foldAround();
    expect(h.state).toMatchObject({ status: 'HELD', holds: ['HAND_FOR_HAND'] });
    h.send({ type: 'RELEASE', reason: 'HAND_FOR_HAND' });
    h.fireNextHand();
    h.foldAround();
    expect(h.state).toMatchObject({ status: 'HELD', holds: ['HAND_FOR_HAND'] });
    // disabling lifts the hold
    h.send({ type: 'SET_HAND_FOR_HAND', enabled: false });
    expect(h.state.status).toBe('BETWEEN_HANDS');
    h.fireNextHand();
    h.foldAround();
    expect(h.state.status).toBe('BETWEEN_HANDS');
  });

  it('enabling between hands holds the table at once', () => {
    const h = threeHanded();
    h.start();
    h.foldAround();
    h.send({ type: 'SET_HAND_FOR_HAND', enabled: true });
    expect(h.state).toMatchObject({ status: 'HELD', holds: ['HAND_FOR_HAND'], nextHand: null });
  });
});

describe('SET_BLINDS', () => {
  it('during a hand: pending until the hand completes, then used by the next hand', () => {
    const h = threeHanded();
    h.start();
    const next = { level: 2, smallBlind: 100, bigBlind: 200, ante: 25, anteType: 'ALL_PLAYERS' as const };
    const t = h.send({ type: 'SET_BLINDS', blinds: next });
    expect(t.events.map((e) => e.event)).toEqual([{ kind: 'BLINDS_SCHEDULED', blinds: next }]);
    expect(h.state.pendingBlinds).toEqual(next);
    expect(h.state.blinds).toEqual(BLINDS);
    expect(h.state.hand?.bigBlind).toBe(100);
    h.foldAround();
    expect(h.state.blinds).toEqual(next);
    expect(h.state.pendingBlinds).toBeNull();
    h.fireNextHand();
    expect(h.payloads('HAND_STARTED')[1]).toMatchObject({
      smallBlind: 100,
      bigBlind: 200,
      ante: 25,
      anteType: 'ALL_PLAYERS',
    });
  });

  it('between hands: applies to the next hand directly; invalid blinds rejected', () => {
    const h = threeHanded();
    h.send({ type: 'SET_BLINDS', blinds: { ...BLINDS, level: 2, bigBlind: 300, smallBlind: 150 } });
    expect(h.state.blinds.bigBlind).toBe(300);
    expect(h.send({ type: 'SET_BLINDS', blinds: { ...BLINDS, bigBlind: 0 } }).reply?.code).toBe('INVALID_COMMAND');
    expect(h.send({ type: 'SET_BLINDS', blinds: { ...BLINDS, anteType: 'WEIRD' as never } }).reply?.code).toBe(
      'INVALID_COMMAND',
    );
    h.start();
    expect(h.payloads('HAND_STARTED')[0]).toMatchObject({ bigBlind: 300 });
  });
});

describe('ADMIN_ADJUST_STACK', () => {
  it('only between hands; emits STACK_ADJUSTED', () => {
    const h = threeHanded();
    h.start();
    expect(h.send({ type: 'ADMIN_ADJUST_STACK', playerId: 'a', newStack: 1 }).reply?.code).toBe('HAND_IN_PROGRESS');
    h.foldAround();
    const before = h.occupant('a')?.stack;
    const t = h.send({ type: 'ADMIN_ADJUST_STACK', playerId: 'a', newStack: 12_345 });
    expect(t.events.map((e) => e.event)).toEqual([
      { kind: 'STACK_ADJUSTED', seat: 0, playerId: 'a', before, after: 12_345 },
    ]);
    expect(h.occupant('a')?.stack).toBe(12_345);
    expect(h.send({ type: 'ADMIN_ADJUST_STACK', playerId: 'a', newStack: 0 }).reply?.code).toBe('INVALID_COMMAND');
    expect(h.send({ type: 'ADMIN_ADJUST_STACK', playerId: 'zz', newStack: 5 }).reply?.code).toBe('PLAYER_NOT_SEATED');
  });
});

describe('CLOSE', () => {
  it('only between hands; terminal: later commands are rejected and timers ignored', () => {
    const h = threeHanded();
    h.start();
    expect(h.send({ type: 'CLOSE' }).reply?.code).toBe('HAND_IN_PROGRESS');
    h.foldAround();
    const token = h.state.nextHand?.token as string;
    h.send({ type: 'CLOSE' });
    expect(h.state).toMatchObject({ status: 'CLOSED', nextHand: null, turn: null });
    expect(h.lastPayloads()).toEqual([{ kind: 'TABLE_STATUS_CHANGED', status: 'CLOSED', holds: [], frozen: false }]);
    const closed = h.state;
    expect(h.send({ type: 'TIMER_FIRED', kind: 'NEXT_HAND', token }, h.now + 10_000).state).toBe(closed);
    for (const c of [
      { type: 'START' },
      { type: 'HOLD', reason: 'PAUSE' },
      { type: 'CLOSE' },
      { type: 'UNFREEZE' },
    ] as const) {
      expect(h.send(c).reply?.code).toBe('TABLE_CLOSED');
    }
    expect(h.state).toBe(closed);
  });
});

describe('integrity: a bad deck provider holds the table instead of crashing', () => {
  it('invalid deck -> INTEGRITY_VIOLATION + HOLD(INTEGRITY), hand number not consumed', () => {
    const h = threeHanded();
    h.rigged.set(1, ['As', 'As'] as never);
    h.start();
    expect(h.lastPayloads().map((e) => e.kind)).toEqual(['INTEGRITY_VIOLATION', 'TABLE_STATUS_CHANGED']);
    expect(h.state).toMatchObject({ status: 'HELD', holds: ['INTEGRITY'], handNumber: 0 });
    h.rigged.delete(1);
    h.send({ type: 'RELEASE', reason: 'INTEGRITY' });
    h.fireNextHand();
    expect(h.state).toMatchObject({ status: 'IN_HAND', handNumber: 1 });
  });

  it('a throwing deck provider is reported the same way', () => {
    const h = new Harness({
      initialButtonSeat: 0,
      deckFor: () => {
        throw new Error('seed store offline');
      },
    });
    h.seat('a', 0);
    h.seat('b', 1);
    h.start();
    expect(h.payloads('INTEGRITY_VIOLATION')[0]).toMatchObject({ code: 'DECK_PROVIDER_FAILED' });
    expect(h.payloads('INTEGRITY_VIOLATION')[0]?.detail).toContain('seed store offline');
    expect(h.state).toMatchObject({ status: 'HELD', holds: ['INTEGRITY'], handNumber: 0, hand: null });
  });
});

describe('status announcements', () => {
  it('TABLE_STATUS_CHANGED is emitted once per change with holds and frozen', () => {
    const h = threeHanded();
    h.start();
    h.foldAround();
    const statuses = h.payloads('TABLE_STATUS_CHANGED').map((e) => e.status);
    expect(statuses).toEqual(['IN_HAND', 'BETWEEN_HANDS']);
    h.send({ type: 'FREEZE' });
    h.send({ type: 'HOLD', reason: 'PAUSE' });
    expect(h.payloads('TABLE_STATUS_CHANGED').slice(-2)).toEqual([
      { kind: 'TABLE_STATUS_CHANGED', status: 'BETWEEN_HANDS', holds: [], frozen: true },
      { kind: 'TABLE_STATUS_CHANGED', status: 'HELD', holds: ['PAUSE'], frozen: true },
    ]);
  });

  it('tracks lastProgressAt on progress', () => {
    const h = threeHanded();
    h.advance(1234);
    h.start();
    expect(h.state.lastProgressAt).toBe(h.now);
    h.advance(10);
    h.act({ type: 'CALL' });
    expect(h.state.lastProgressAt).toBe(h.now);
  });
});
