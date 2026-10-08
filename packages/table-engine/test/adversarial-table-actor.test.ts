/**
 * ADVERSARIAL (actor semantics). Idempotency and duplicates, stale versions,
 * hostile payloads, pending removals with the exact stack, holds and
 * hand-for-hand, SET_BLINDS timing, view privacy after mucks and seat re-use,
 * replay through a JSON snapshot after EVERY command, gap-free seqs
 * (CONTRACTS §4).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TableCommand, TableCommandEnvelope, TableEvent } from '@jpb/shared-types';
import { adminView, checkTableInvariants, playerView, reduceTable, spectatorView } from '../src';
import type { TableState } from '../src';
import { BLINDS, Harness, TABLE_ID, TIMING, ZERO_STATS } from './helpers';
import { simulate } from './sim';

function headsUp(): Harness {
  const h = new Harness({ initialButtonSeat: 0 });
  h.seat('a', 0);
  h.seat('b', 1);
  h.start();
  return h;
}

const CARD_RE = /"([2-9TJQKA][cdhs])"/g;
const cardsIn = (v: unknown): string[] => [...JSON.stringify(v).matchAll(CARD_RE)].map((m) => m[1] as string);

describe('adversarial-table: idempotency', () => {
  it('BUG actionId idempotency is not scoped per player: player B’s action is swallowed and answered ok because player A used the same actionId', () => {
    const h = headsUp();
    expect(h.act({ type: 'CALL' }, { actionId: 'client-0001' }).ok).toBe(true); // a completes the SB
    expect(h.state.turn?.playerId).toBe('b');
    const acted = h.payloads('PLAYER_ACTED').length;
    const r = h.act({ type: 'CHECK' }, { actionId: 'client-0001', playerId: 'b' });
    const applied = h.payloads('PLAYER_ACTED').length > acted;
    // A reply may only say ok when this player's action was really applied.
    expect(r.ok, `reply ${JSON.stringify(r)} but applied=${applied}`).toBe(applied);
  });

  it('a duplicate never re-applies, even when it is the same player’s turn again with a matching turnVersion', () => {
    const h = headsUp();
    h.act({ type: 'CALL' });
    const v = h.state.turn?.turnVersion ?? null;
    expect(h.act({ type: 'CHECK' }, { actionId: 'bb-check-1', version: v }).ok).toBe(true); // b checks preflop
    // flop: b acts first heads-up; a retry of the same id (network resend) must not check the flop
    const flopTurn = h.state.turn;
    expect(flopTurn?.playerId).toBe('b');
    const before = h.state;
    const dup = h.act({ type: 'CHECK' }, { actionId: 'bb-check-1', version: flopTurn?.turnVersion ?? null });
    expect(dup).toEqual({ ok: true, code: null, message: null, duplicate: true });
    expect(h.state).toBe(before);
  });
});

describe('adversarial-table: stale versions', () => {
  it('a click racing the timeout is not applied to the player’s NEXT decision (old turnVersion)', () => {
    const h = headsUp();
    h.act({ type: 'CALL' });
    const preflop = h.state.turn;
    if (preflop === null) throw new Error('no turn');
    expect(preflop.playerId).toBe('b');
    h.fireTurnTimer(); // b checks by timeout; flop: b again
    const flop = h.state.turn;
    expect(flop?.playerId).toBe('b');
    expect(flop?.turnVersion).not.toBe(preflop.turnVersion);
    const r = h.act({ type: 'CHECK' }, { version: preflop.turnVersion, actionId: 'racy-click' });
    expect(r).toMatchObject({ ok: false, code: 'STALE_STATE_VERSION' });
    expect(h.act({ type: 'CHECK' }, { version: flop?.turnVersion ?? null }).ok).toBe(true);
  });

  it('unrelated accepted commands between the request and the click do not make the turnVersion stale', () => {
    const h = headsUp();
    const v = h.state.turn?.turnVersion ?? null;
    h.seat('late', 5);
    h.send({ type: 'PLAYER_CONNECTION', playerId: 'b', connected: false });
    h.send({ type: 'SET_BLINDS', blinds: { ...BLINDS, level: 2 } });
    h.send({ type: 'HOLD', reason: 'PAUSE' });
    h.send({ type: 'SET_TIMING', timing: TIMING });
    expect(h.state.version).toBeGreaterThan(v as number);
    expect(h.act({ type: 'CALL' }, { version: v }).ok).toBe(true);
  });

  it('a future or non-numeric tableStateVersion is stale, never accepted', () => {
    const h = headsUp();
    const v = h.state.turn?.turnVersion as number;
    expect(h.act({ type: 'CALL' }, { version: v + 1, actionId: 'future-1' }).code).toBe('STALE_STATE_VERSION');
    const r = h.send({
      type: 'PLAYER_ACTION',
      actionId: 'string-version',
      playerId: 'a',
      intent: { type: 'CALL' },
      tableStateVersion: String(v) as unknown as number,
    }).reply;
    expect(r?.ok).toBe(false);
    expect(h.state.turn?.playerId).toBe('a');
  });
});

describe('adversarial-table: hostile payloads never throw', () => {
  const env = (command: unknown, at = 2_000_000): TableCommandEnvelope =>
    ({ commandId: 'x', tableId: TABLE_ID, at, command }) as TableCommandEnvelope;

  it('malformed PLAYER_ACTION intents get typed rejections and leave the version unchanged', () => {
    const h = headsUp();
    const v = h.state.turn?.turnVersion as number;
    const intents: unknown[] = [
      null,
      'FOLD',
      42,
      {},
      { type: 'BET', amount: '500' },
      { type: 'RAISE', amount: Number.NaN },
      { type: 'RAISE', amount: Number.POSITIVE_INFINITY },
      { type: 'RAISE', amount: -1 },
      { type: 'RAISE', amount: 2 ** 60 },
      { type: 'raise', amount: 400 },
      { type: ['CALL'] },
    ];
    intents.forEach((intent, i) => {
      const t = reduceTable(
        h.state,
        env({ type: 'PLAYER_ACTION', actionId: `bad-${i}`, playerId: 'a', intent, tableStateVersion: v }, h.now),
        h.ctx,
      );
      expect(t.reply?.ok, JSON.stringify(intent)).toBe(false);
      expect(t.reply?.code).not.toBeNull();
      expect(t.state.version).toBe(h.state.version);
      expect(t.events).toEqual([]);
      expect(checkTableInvariants(t.state)).toEqual([]);
    });
  });

  it('malformed commands of every type are INVALID_COMMAND (or a specific code), never an exception', () => {
    const h = headsUp();
    const cmds: unknown[] = [
      null,
      {},
      { type: 'NOPE' },
      { type: 'SEAT_PLAYER', playerId: 'z', displayName: 'Z', publicId: 'Z', seat: '2', stack: 100, stats: ZERO_STATS, moveId: null },
      { type: 'SEAT_PLAYER', playerId: 'z', displayName: 'Z', publicId: 'Z', seat: 2, stack: 1.5, stats: ZERO_STATS, moveId: null },
      { type: 'SEAT_PLAYER', playerId: 'z', displayName: 'Z', publicId: 'Z', seat: 2, stack: 100, stats: null, moveId: null },
      { type: 'SEAT_PLAYER', playerId: 'z', displayName: 'Z', publicId: 'Z', seat: 2, stack: 100, stats: ZERO_STATS, moveId: 5 },
      { type: 'REMOVE_PLAYER', playerId: 'a', reason: 'BORED', moveId: null },
      { type: 'REMOVE_PLAYER', playerId: 7, reason: 'MOVED', moveId: null },
      { type: 'SET_BLINDS', blinds: null },
      { type: 'SET_BLINDS', blinds: { ...BLINDS, smallBlind: 200, bigBlind: 100 } },
      { type: 'SET_TIMING', timing: { ...TIMING, actionTimerMs: -1 } },
      { type: 'HOLD', reason: 'NAP' },
      { type: 'RELEASE', reason: null },
      { type: 'SET_HAND_FOR_HAND', enabled: 'yes' },
      { type: 'PLAYER_CONNECTION', playerId: 'a', connected: 'no' },
      { type: 'ADMIN_ADD_TIME', ms: '5000' },
      { type: 'ADMIN_ADJUST_STACK', playerId: 'a', newStack: -1 },
      { type: 'PLAYER_ACTION', actionId: 5, playerId: 'a', intent: { type: 'CALL' }, tableStateVersion: 1 },
      { type: 'PLAYER_ACTION' },
    ];
    for (const c of cmds) {
      let t: ReturnType<typeof reduceTable> | null = null;
      expect(() => {
        t = reduceTable(h.state, env(c, h.now), h.ctx);
      }, JSON.stringify(c)).not.toThrow();
      const tt = t as unknown as ReturnType<typeof reduceTable>;
      expect(tt.reply?.ok, JSON.stringify(c)).toBe(false);
      expect(tt.state.version).toBe(h.state.version);
      expect(tt.events).toEqual([]);
    }
    // malformed timers: ignored silently
    for (const c of [
      { type: 'TIMER_FIRED', kind: 'BOGUS', token: 'x' },
      { type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: 42 },
      { type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT' },
    ]) {
      const t = reduceTable(h.state, env(c, h.now + 10_000_000), h.ctx);
      expect(t.state).toBe(h.state);
      expect(t.reply).toBeNull();
    }
    // malformed envelopes
    for (const e of [null, {}, { tableId: TABLE_ID, at: -1, command: { type: 'START' } }, { tableId: TABLE_ID, at: 1.5, command: { type: 'START' } }]) {
      const t = reduceTable(h.state, e as TableCommandEnvelope, h.ctx);
      expect(t.reply?.code).toBe('INVALID_COMMAND');
      expect(t.state).toBe(h.state);
    }
  });
});

describe('adversarial-table: pending removal with the exact stack', () => {
  it('a player removed mid-hand keeps acting, wins the blinds, gets the uncalled bet back and leaves with the exact stack', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0);
    h.seat('p3', 3);
    h.seat('p5', 5);
    h.start(); // button 0, SB 3, BB 5; p0 first to act preflop
    expect(h.state.turn?.playerId).toBe('p0');
    expect(h.send({ type: 'REMOVE_PLAYER', playerId: 'p0', reason: 'MOVED', moveId: 'mv-1' }).reply).toMatchObject({
      ok: true,
    });
    expect(h.payloads('PLAYER_REMOVED')).toEqual([]);
    expect(h.act({ type: 'RAISE', amount: 1_000 }).ok).toBe(true);
    h.act({ type: 'FOLD' }); // SB
    const t = h.send({
      type: 'PLAYER_ACTION',
      actionId: 'bb-fold',
      playerId: 'p5',
      intent: { type: 'FOLD' },
      tableStateVersion: h.state.turn?.turnVersion ?? null,
    });
    const kinds = t.events.map((e) => e.event.kind);
    expect(kinds.indexOf('HAND_RESULT')).toBeLessThan(kinds.indexOf('PLAYER_REMOVED'));
    expect(h.payloads('UNCALLED_BET_RETURNED')).toEqual([expect.objectContaining({ seat: 0, amount: 900 })]);
    const result = h.payloads('HAND_RESULT')[0]?.result;
    expect(result?.players.find((p) => p.playerId === 'p0')).toMatchObject({ startingStack: 10_000, finalStack: 10_150 });
    expect(result?.totalChipsAtTable).toBe(30_000);
    expect(h.payloads('PLAYER_REMOVED')).toEqual([
      expect.objectContaining({ seat: 0, playerId: 'p0', reason: 'MOVED', moveId: 'mv-1', stack: 10_150 }),
    ]);
    expect(h.state.status).toBe('BETWEEN_HANDS');
    h.fireNextHand();
    // heads-up now: BB = first participant after 5 = 3; 5 is button and SB.
    expect(h.payloads('HAND_STARTED')[1]).toMatchObject({ buttonSeat: 5, smallBlindSeat: 5, bigBlindSeat: 3 });
  });

  it('pending removal of the last opponent: the hand completes, the table goes WAITING and NEXT_HAND never fires', () => {
    const h = headsUp();
    h.send({ type: 'REMOVE_PLAYER', playerId: 'b', reason: 'TABLE_BROKEN', moveId: null });
    h.foldAround();
    expect(h.payloads('PLAYER_REMOVED')).toEqual([
      expect.objectContaining({ playerId: 'b', reason: 'TABLE_BROKEN', stack: 10_050 }),
    ]);
    expect(h.state.status).toBe('WAITING');
    expect(h.state.nextHand).toBeNull();
    expect(h.last?.timers.filter((x) => x.kind === 'NEXT_HAND')).toEqual([]);
  });
});

describe('adversarial-table: holds and hand-for-hand', () => {
  it('hand-for-hand: holds after every hand (even after a showdown), RELEASE schedules exactly betweenHandsDelayMs, other holds still block', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('a', 0);
    h.seat('b', 1);
    h.seat('c', 2);
    h.start();
    h.send({ type: 'SET_HAND_FOR_HAND', enabled: true });
    expect(h.state.status).toBe('IN_HAND');
    expect(h.state.holds).toEqual([]);
    // check/call down to a showdown
    h.foldAround();
    expect(h.state.status).toBe('HELD');
    expect(h.state.holds).toEqual(['HAND_FOR_HAND']);
    expect(h.state.nextHand).toBeNull();
    expect(h.last?.timers).toEqual([]);
    h.send({ type: 'HOLD', reason: 'BREAK' }, h.now + 1_000);
    const r1 = h.send({ type: 'RELEASE', reason: 'HAND_FOR_HAND' }, h.now + 1_000);
    expect(h.state.status).toBe('HELD');
    expect(r1.timers).toEqual([]);
    const r2 = h.send({ type: 'RELEASE', reason: 'BREAK' }, h.now + 1_000);
    expect(h.state.status).toBe('BETWEEN_HANDS');
    expect(r2.timers).toEqual([{ kind: 'NEXT_HAND', at: h.now + TIMING.betweenHandsDelayMs, token: h.state.nextHand?.token }]);
    h.fireNextHand();
    h.foldAround();
    expect(h.state.holds).toEqual(['HAND_FOR_HAND']);
    // disabling lifts the hold
    h.send({ type: 'SET_HAND_FOR_HAND', enabled: false });
    expect(h.state.status).toBe('BETWEEN_HANDS');
  });

  it('a hold placed mid-hand never stops the hand: actions and timeouts are still processed', () => {
    const h = headsUp();
    h.send({ type: 'HOLD', reason: 'PAUSE' });
    expect(h.state.status).toBe('IN_HAND');
    expect(h.act({ type: 'CALL' }).ok).toBe(true);
    h.fireTurnTimer();
    expect(h.payloads('PLAYER_ACTED').at(-1)).toMatchObject({ playerId: 'b', action: 'CHECK', timeout: true });
    h.foldAround();
    expect(h.state.status).toBe('HELD');
    expect(h.state.nextHand).toBeNull();
  });

  it('RELEASE while frozen stores the delay; UNFREEZE schedules it', () => {
    const h = headsUp();
    h.foldAround();
    h.send({ type: 'HOLD', reason: 'ADMIN' });
    h.send({ type: 'FREEZE' });
    const r = h.send({ type: 'RELEASE', reason: 'ADMIN' }, h.now + 500);
    expect(r.timers).toEqual([]);
    expect(h.state.frozen?.nextHandRemainingMs).toBe(TIMING.betweenHandsDelayMs);
    const u = h.send({ type: 'UNFREEZE' }, h.now + 60_000);
    expect(u.timers).toEqual([{ kind: 'NEXT_HAND', at: h.now + TIMING.betweenHandsDelayMs, token: h.state.nextHand?.token }]);
  });
});

describe('adversarial-table: SET_BLINDS applies only from the next hand', () => {
  it('mid-hand blind changes (even several, even while frozen) never change the running hand; the last one wins', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('a', 0);
    h.seat('b', 1);
    h.seat('c', 2);
    h.start(); // button 0, SB 1, BB 2: a first to act
    const lvl2 = { level: 2, smallBlind: 200, bigBlind: 400, ante: 50, anteType: 'BB_ANTE' as const };
    const lvl3 = { level: 3, smallBlind: 300, bigBlind: 600, ante: 0, anteType: 'NONE' as const };
    h.send({ type: 'SET_BLINDS', blinds: lvl2 });
    h.send({ type: 'FREEZE' });
    h.send({ type: 'SET_BLINDS', blinds: lvl3 });
    h.send({ type: 'UNFREEZE' });
    expect(h.state.blinds).toEqual(BLINDS);
    expect(h.state.pendingBlinds).toEqual(lvl3);
    // the running hand still uses BB 100: min raise to 200
    expect(h.legal()).toMatchObject({ currentBet: 100, minTo: 200 });
    expect(h.act({ type: 'RAISE', amount: 200 }).ok).toBe(true);
    expect(spectatorView(h.state, h.now).blinds).toEqual(BLINDS);
    h.foldAround();
    expect(h.state.blinds).toEqual(lvl3);
    expect(h.state.pendingBlinds).toBeNull();
    h.fireNextHand();
    expect(h.payloads('HAND_STARTED')[1]).toMatchObject({ smallBlind: 300, bigBlind: 600, ante: 0, anteType: 'NONE' });
    expect(h.payloads('BLINDS_SCHEDULED').map((e) => e.blinds.level)).toEqual([2, 3]);
  });
});

describe('adversarial-table: view privacy after mucks and seat re-use', () => {
  it('mucked cards never appear in any non-hole-card view, nor for a newcomer who takes the mucker’s seat', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('p0', 0);
    h.seat('p1', 1);
    h.seat('p2', 2);
    // button 0, SB 1, BB 2. No river bet: first live seat after the button (1) shows first.
    h.rigNextHand(
      { 1: ['As', 'Ah'], 2: ['7c', '2d'], 0: ['8c', '3d'] },
      ['Kd', 'Qc', '9s', '5h', '4c'],
    );
    h.start();
    // everyone calls / checks down to the river
    let guard = 0;
    while (h.state.turn !== null && guard++ < 30) h.act(h.legal().canCheck ? { type: 'CHECK' } : { type: 'CALL' });
    const sd = h.payloads('SHOWDOWN')[0];
    expect(sd?.reveals.find((r) => r.seat === 1)?.cards).toEqual(['As', 'Ah']);
    expect(sd?.reveals.filter((r) => r.mucked).map((r) => r.seat).sort()).toEqual([0, 2]);
    const hidden = ['7c', '2d', '8c', '3d'];
    const noHidden = (label: string, v: unknown, allowed: string[] = []): void => {
      for (const c of cardsIn(v)) expect(hidden.includes(c) && !allowed.includes(c), `${label} leaks ${c}`).toBe(false);
    };
    noHidden('spectator', spectatorView(h.state, h.now));
    noHidden('admin(no cards)', adminView(h.state, h.now, { includeHoleCards: false }));
    noHidden('p1', playerView(h.state, 'p1', h.now));
    noHidden('p0', playerView(h.state, 'p0', h.now), ['8c', '3d']);
    noHidden('p2', playerView(h.state, 'p2', h.now), ['7c', '2d']);
    // p2 leaves; a newcomer sits in seat 2 before the next deal
    h.send({ type: 'REMOVE_PLAYER', playerId: 'p2', reason: 'MOVED', moveId: 'm' });
    expect(playerView(h.state, 'p2', h.now)).toBeNull();
    h.seat('n2', 2);
    const nv = playerView(h.state, 'n2', h.now);
    expect(nv?.you.holeCards).toBeNull();
    noHidden('newcomer', nv);
    expect(nv?.seats[2]?.shownCards).toBeNull();
    // public events of the whole run never carried a mucked card
    for (const e of h.events) if (e.visibility === 'PUBLIC') noHidden(`event ${e.event.kind}`, e.event);
    for (const e of h.events.filter((x) => x.visibility === 'PRIVATE')) expect(e.event.kind).toBe('HOLE_CARDS_DEALT');
  });
});

describe('adversarial-table: replay determinism through a JSON snapshot after every command', () => {
  function replayWithSnapshots(initial: TableState, envelopes: readonly TableCommandEnvelope[], ctx: Harness['ctx']) {
    let state = initial;
    const events: TableEvent[] = [];
    for (const env of envelopes) {
      const snap = JSON.parse(JSON.stringify(state)) as TableState;
      const t = reduceTable(snap, JSON.parse(JSON.stringify(env)) as TableCommandEnvelope, ctx);
      state = t.state;
      events.push(...t.events);
    }
    return { state, events };
  }

  it('property: replaying from JSON snapshots taken before every command gives the identical stream and state', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const { h } = simulate({ seed, hands: 15 });
        const r = replayWithSnapshots(h.initial, h.envelopes, h.ctx);
        expect(r.events).toEqual(h.events);
        expect(JSON.parse(JSON.stringify(r.state))).toEqual(JSON.parse(JSON.stringify(h.state)));
        // gap-free seqs from 1, versions match the state, views expose the last seq and version
        h.events.forEach((e, i) => expect(e.seq).toBe(i + 1));
        const view = spectatorView(h.state, h.now);
        expect(view.lastEventSeq).toBe(h.events.at(-1)?.seq ?? 0);
        expect(view.version).toBe(h.state.version);
        expect(h.state.nextEventSeq).toBe(h.events.length + 1);
      }),
      { numRuns: 10 },
    );
  });

  it('versions: each accepted command bumps exactly one version and all its events carry it', () => {
    const { h } = simulate({ seed: 99, hands: 20 });
    let state = h.initial;
    for (const env of h.envelopes) {
      const t = reduceTable(state, env, h.ctx);
      const accepted = t.state.version !== state.version;
      if (accepted) expect(t.state.version).toBe(state.version + 1);
      else expect(t.events).toEqual([]);
      for (const e of t.events) expect(e.version).toBe(t.state.version);
      expect(t.state.nextEventSeq).toBe(state.nextEventSeq + t.events.length);
      state = t.state;
    }
  });
});

describe('adversarial-table: commands on a CLOSED table', () => {
  it('every command type is rejected with TABLE_CLOSED and timers are ignored', () => {
    const h = headsUp();
    h.foldAround();
    const tok = h.state.nextHand?.token as string;
    expect(h.send({ type: 'CLOSE' }).reply?.ok).toBe(true);
    const all: TableCommand[] = [
      { type: 'SEAT_PLAYER', playerId: 'z', displayName: 'Z', publicId: 'Z', seat: 5, stack: 100, stats: ZERO_STATS, moveId: null },
      { type: 'REMOVE_PLAYER', playerId: 'a', reason: 'TABLE_BROKEN', moveId: null },
      { type: 'SET_BLINDS', blinds: BLINDS },
      { type: 'SET_TIMING', timing: TIMING },
      { type: 'HOLD', reason: 'PAUSE' },
      { type: 'RELEASE', reason: 'PAUSE' },
      { type: 'SET_HAND_FOR_HAND', enabled: true },
      { type: 'FREEZE' },
      { type: 'UNFREEZE' },
      { type: 'PLAYER_ACTION', actionId: 'closed-1', playerId: 'a', intent: { type: 'FOLD' }, tableStateVersion: 1 },
      { type: 'PLAYER_CONNECTION', playerId: 'a', connected: false },
      { type: 'ADMIN_FORCE_TIMEOUT' },
      { type: 'ADMIN_ADJUST_STACK', playerId: 'a', newStack: 5 },
      { type: 'ADMIN_ADD_TIME', ms: 5 },
      { type: 'START' },
      { type: 'CLOSE' },
    ];
    for (const c of all) {
      const before = h.state;
      const t = h.send(c);
      expect(t.reply?.code, c.type).toBe('TABLE_CLOSED');
      expect(t.state.version).toBe(before.version);
      expect(t.events).toEqual([]);
    }
    const before = h.state;
    expect(h.send({ type: 'TIMER_FIRED', kind: 'NEXT_HAND', token: tok }, h.now + 60_000).state).toBe(before);
  });
});
