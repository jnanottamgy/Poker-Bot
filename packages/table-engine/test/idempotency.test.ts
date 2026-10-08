import { describe, expect, it } from 'vitest';
import { RECENT_ACTION_CAPACITY, reduceTable } from '../src';
import { Harness, TABLE_ID } from './helpers';

function headsUp(): Harness {
  const h = new Harness({ initialButtonSeat: 0 });
  h.seat('a', 0);
  h.seat('b', 1);
  h.start();
  return h;
}

describe('idempotent PLAYER_ACTION', () => {
  it('the same actionId twice has one effect and returns the original reply with duplicate: true', () => {
    const h = headsUp();
    const version = h.state.turn?.turnVersion ?? null;
    const first = h.act({ type: 'CALL' }, { actionId: 'x1', version });
    expect(first).toEqual({ ok: true, code: null, message: null, duplicate: false });
    const after = h.state;
    const eventsBefore = h.events.length;
    const second = h.send({
      type: 'PLAYER_ACTION',
      actionId: 'x1',
      playerId: 'a',
      intent: { type: 'CALL' },
      tableStateVersion: version,
    });
    expect(second.reply).toEqual({ ok: true, code: null, message: null, duplicate: true });
    expect(second.state).toBe(after);
    expect(h.events.length).toBe(eventsBefore);
    // even with a different (now illegal) intent, the duplicate returns the original reply
    expect(h.act({ type: 'RAISE', amount: 5 }, { actionId: 'x1', playerId: 'a' })).toEqual({
      ...first,
      duplicate: true,
    });
  });

  it('a rejected action is remembered too: a retry returns the same rejection', () => {
    const h = headsUp();
    const r1 = h.act({ type: 'CHECK' }, { actionId: 'bad' });
    expect(r1).toMatchObject({ ok: false, code: 'CHECK_NOT_ALLOWED', duplicate: false });
    const version = h.state.version;
    expect(h.state.recentActions.at(-1)).toMatchObject({ actionId: 'bad', reply: r1 });
    const r2 = h.act({ type: 'CALL' }, { actionId: 'bad' });
    expect(r2).toEqual({ ...r1, duplicate: true });
    expect(h.state.version).toBe(version);
    expect(h.act({ type: 'CALL' }, { actionId: 'good' }).ok).toBe(true);
  });

  it('duplicates are answered even after the table closed', () => {
    const h = headsUp();
    h.act({ type: 'FOLD' }, { actionId: 'f1' });
    h.send({ type: 'CLOSE' });
    expect(h.act({ type: 'FOLD' }, { actionId: 'f1', playerId: 'a' })).toMatchObject({ ok: true, duplicate: true });
    expect(h.act({ type: 'FOLD' }, { actionId: 'f2', playerId: 'a' })).toMatchObject({
      ok: false,
      code: 'TABLE_CLOSED',
    });
  });

  it(`remembers the last ${RECENT_ACTION_CAPACITY} action ids (FIFO)`, () => {
    const h = new Harness({ freeze: false, invariants: false });
    h.seat('a', 0);
    h.seat('b', 1);
    for (let i = 0; i < RECENT_ACTION_CAPACITY + 10; i += 1) {
      // no hand running: every action is rejected (NO_ACTIVE_HAND) and remembered
      expect(h.act({ type: 'FOLD' }, { actionId: `id${i}`, playerId: 'a', version: null }).code).toBe('NO_ACTIVE_HAND');
    }
    expect(h.state.recentActions).toHaveLength(RECENT_ACTION_CAPACITY);
    expect(h.state.recentActions[0]?.actionId).toBe('id10');
    expect(h.act({ type: 'FOLD' }, { actionId: 'id10', playerId: 'a', version: null }).duplicate).toBe(true);
    expect(h.act({ type: 'FOLD' }, { actionId: 'id9', playerId: 'a', version: null }).duplicate).toBe(false);
  });

  it('malformed actionId/playerId is INVALID_COMMAND and not remembered', () => {
    const h = headsUp();
    const r = h.send({
      type: 'PLAYER_ACTION',
      actionId: '',
      playerId: 'a',
      intent: { type: 'CALL' },
      tableStateVersion: null,
    });
    expect(r.reply?.code).toBe('INVALID_COMMAND');
    expect(h.state.recentActions).toHaveLength(0);
  });
});

describe('turn validation', () => {
  it('stale tableStateVersion is rejected; the current one is accepted; null skips the check', () => {
    const h = headsUp();
    const v = h.state.turn?.turnVersion as number;
    expect(h.act({ type: 'CALL' }, { version: v - 1 })).toMatchObject({ ok: false, code: 'STALE_STATE_VERSION' });
    expect(h.act({ type: 'CALL' }, { version: v + 1 })).toMatchObject({ ok: false, code: 'STALE_STATE_VERSION' });
    expect(h.act({ type: 'CALL' }, { version: v })).toMatchObject({ ok: true });
    // b now; an action carrying a's old version is stale for b's turn
    expect(h.act({ type: 'CHECK' }, { version: v })).toMatchObject({ ok: false, code: 'STALE_STATE_VERSION' });
    expect(h.act({ type: 'CHECK' }, { version: null })).toMatchObject({ ok: true });
  });

  it('rejects out-of-turn, folded, unseated and illegal actions with codes, never throwing', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('a', 0);
    h.seat('b', 1);
    h.seat('c', 2);
    expect(h.act({ type: 'FOLD' }, { playerId: 'a', version: null }).code).toBe('NO_ACTIVE_HAND');
    h.start(); // a first
    expect(h.act({ type: 'CALL' }, { playerId: 'b' }).code).toBe('NOT_YOUR_TURN');
    expect(h.act({ type: 'CALL' }, { playerId: 'zed' }).code).toBe('PLAYER_NOT_SEATED');
    expect(h.act({ type: 'RAISE', amount: 150 }).code).toBe('AMOUNT_BELOW_MINIMUM');
    expect(h.act({ type: 'RAISE', amount: 999_999_999 }).code).toBe('AMOUNT_ABOVE_MAXIMUM');
    expect(h.act({ type: 'RAISE', amount: Number.NaN }).code).toBe('AMOUNT_NOT_INTEGER');
    expect(h.act({ type: 'RAISE', amount: 250.5 }).code).toBe('AMOUNT_NOT_INTEGER');
    expect(h.act({ type: 'BET', amount: 300 }).code).toBe('BET_NOT_ALLOWED');
    expect(h.act({ type: 'DANCE' as never }).code).toBe('UNKNOWN_ACTION');
    expect(h.act(null as never).code).toBe('UNKNOWN_ACTION');
    h.act({ type: 'FOLD' }); // a folds
    expect(h.act({ type: 'CALL' }, { playerId: 'a' }).code).toBe('PLAYER_FOLDED');
    h.seat('late', 5);
    expect(h.act({ type: 'CALL' }, { playerId: 'late' }).code).toBe('PLAYER_NOT_IN_HAND');
  });

  it('all-in players cannot act', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('a', 0, 1_000);
    h.seat('b', 1, 5_000);
    h.seat('c', 2, 5_000);
    h.start();
    h.act({ type: 'ALL_IN' }); // a
    expect(h.act({ type: 'CALL' }, { playerId: 'a' }).code).toBe('PLAYER_ALL_IN');
  });
});

describe('versioning and envelopes', () => {
  it('every accepted command increments version by one; rejected commands do not', () => {
    const h = headsUp();
    const v = h.state.version;
    h.send({ type: 'HOLD', reason: 'PAUSE' });
    expect(h.state.version).toBe(v + 1);
    h.send({ type: 'ADMIN_ADJUST_STACK', playerId: 'a', newStack: 5 }); // rejected: hand in progress
    expect(h.state.version).toBe(v + 1);
    h.send({ type: 'HOLD', reason: 'PAUSE' }); // accepted no-op
    expect(h.state.version).toBe(v + 2);
  });

  it('rejects envelopes for another table or with a bad timestamp, and unknown commands', () => {
    const h = headsUp();
    const s = h.state;
    const other = reduceTable(s, { commandId: 'x', tableId: 'OTHER', at: h.now, command: { type: 'START' } }, h.ctx);
    expect(other.state).toBe(s);
    expect(other.reply?.code).toBe('INVALID_COMMAND');
    for (const at of [-1, 1.5, Number.NaN, '5' as never]) {
      expect(
        reduceTable(s, { commandId: 'x', tableId: TABLE_ID, at, command: { type: 'START' } }, h.ctx).reply?.code,
      ).toBe('INVALID_COMMAND');
    }
    expect(
      reduceTable(s, { commandId: 'x', tableId: TABLE_ID, at: h.now, command: { type: 'NOPE' } as never }, h.ctx).reply
        ?.code,
    ).toBe('INVALID_COMMAND');
    expect(reduceTable(s, null as never, h.ctx).reply?.code).toBe('INVALID_COMMAND');
    expect(
      reduceTable(s, { commandId: 'x', tableId: TABLE_ID, at: h.now, command: null } as never, h.ctx).reply?.code,
    ).toBe('INVALID_COMMAND');
  });

  it('clamps time that goes backwards (events and deadlines never move back)', () => {
    const h = headsUp();
    const clock = h.state.clock;
    const t = h.send({ type: 'HOLD', reason: 'ADMIN' }, clock - 5_000);
    expect(t.events.every((e) => e.at === clock)).toBe(true);
    expect(h.state.clock).toBe(clock);
  });
});
