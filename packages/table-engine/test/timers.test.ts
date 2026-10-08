import { describe, expect, it } from 'vitest';
import { Harness, TIMING } from './helpers';

/** Heads-up table, button 0 (SB) acts first preflop. */
function headsUp(): Harness {
  const h = new Harness({ initialButtonSeat: 0 });
  h.seat('a', 0);
  h.seat('b', 1);
  h.start();
  return h;
}

describe('action timers', () => {
  it('timeout applies CHECK when legal, otherwise FOLD, flagged timeout', () => {
    const h = headsUp();
    // 'a' faces the big blind: cannot check -> FOLD.
    const t = h.fireTurnTimer();
    const acted = t.events.find((e) => e.event.kind === 'PLAYER_ACTED')?.event;
    expect(acted).toMatchObject({ playerId: 'a', action: 'FOLD', timeout: true });
    expect(t.reply).toBeNull();
    expect(h.occupant('a')?.consecutiveTimeouts).toBe(1);
    expect(h.state.counters.timeouts).toBe(1);

    h.fireNextHand(); // button 1 (SB) acts first, BB 0
    h.act({ type: 'CALL' }); // b completes
    const t2 = h.fireTurnTimer(); // a in the BB can check
    expect(t2.events.find((e) => e.event.kind === 'PLAYER_ACTED')?.event).toMatchObject({
      playerId: 'a',
      action: 'CHECK',
      timeout: true,
    });
    expect(h.occupant('a')?.consecutiveTimeouts).toBe(2);
  });

  it('a voluntary action resets consecutiveTimeouts', () => {
    const h = headsUp();
    h.fireTurnTimer();
    h.fireNextHand();
    h.act({ type: 'CALL' });
    h.act({ type: 'CHECK' }); // a acts voluntarily
    expect(h.occupant('a')?.consecutiveTimeouts).toBe(0);
  });

  it('stale timer tokens are ignored (no state change, no version bump)', () => {
    const h = headsUp();
    const oldToken = h.state.turn?.timerToken as string;
    h.act({ type: 'CALL' });
    const before = h.state;
    const t = h.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: oldToken }, h.now + 1_000_000);
    expect(t.state).toBe(before);
    expect(t.events).toEqual([]);
    expect(t.timers).toEqual([]);
    expect(t.reply).toBeNull();
    // unknown kinds and garbage tokens too
    expect(h.send({ type: 'TIMER_FIRED', kind: 'NEXT_HAND', token: 'nope' }).state).toBe(before);
  });

  it('a timer delivered early is not applied; the same timer is requested again', () => {
    const h = headsUp();
    const turn = h.state.turn;
    if (turn === null) throw new Error('no turn');
    const due = turn.deadline + TIMING.actionGraceMs;
    const before = h.state;
    const t = h.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: turn.timerToken }, due - 1);
    expect(t.state).toBe(before);
    expect(t.timers).toEqual([{ kind: 'ACTION_TIMEOUT', at: due, token: turn.timerToken }]);
    expect(h.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: turn.timerToken }, due).state.version).toBe(
      before.version + 1,
    );
  });

  it('away players (after awayAfterTimeouts timeouts) get the away timer; reconnect/voluntary action restores the normal timer', () => {
    const h = headsUp();
    h.fireTurnTimer(); // a: 1 timeout (fold)
    h.fireNextHand(); // b SB first
    h.act({ type: 'CALL' });
    h.fireTurnTimer(); // a: 2 timeouts (check) -> away from now on
    // flop: BB (a) acts first postflop heads-up
    expect(h.state.turn?.playerId).toBe('a');
    expect(h.state.turn?.timerMs).toBe(TIMING.awayActionTimerMs);
    expect(h.state.turn?.away).toBe(true);
    const req = h.last?.events.filter((e) => e.event.kind === 'ACTION_REQUESTED').at(-1)?.event;
    expect(req).toMatchObject({ timerMs: TIMING.awayActionTimerMs, deadline: h.now + TIMING.awayActionTimerMs });
    // a voluntary action resets the count; the next turn uses the normal timer
    h.act({ type: 'CHECK' });
    h.act({ type: 'CHECK' }); // b
    expect(h.state.turn?.playerId).toBe('a');
    expect(h.state.turn?.timerMs).toBe(TIMING.actionTimerMs);
  });

  it('a disconnected player gets the away timer; reconnecting resets timeouts and restores the full timer', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('a', 0);
    h.seat('b', 1);
    h.seat('c', 2);
    h.send({ type: 'PLAYER_CONNECTION', playerId: 'a', connected: false });
    expect(h.lastPayloads()).toEqual([{ kind: 'PLAYER_CONNECTION_CHANGED', seat: 0, playerId: 'a', connected: false }]);
    h.start(); // 3-handed: button 0 acts first preflop
    expect(h.state.turn).toMatchObject({ playerId: 'a', timerMs: TIMING.awayActionTimerMs, away: true });
    h.fireTurnTimer(); // folds
    h.foldAround();
    h.send({ type: 'PLAYER_CONNECTION', playerId: 'a', connected: true });
    expect(h.occupant('a')).toMatchObject({ connected: true, consecutiveTimeouts: 0 });
    h.fireNextHand(); // button 1, SB 2, BB 0 -> b (button) first
    h.act({ type: 'CALL' }); // b
    h.act({ type: 'CALL' }); // c (SB)
    expect(h.state.turn).toMatchObject({ playerId: 'a', timerMs: TIMING.actionTimerMs, away: false });
    // unchanged connection state: accepted, no event
    const t = h.send({ type: 'PLAYER_CONNECTION', playerId: 'a', connected: true });
    expect(t.reply?.ok).toBe(true);
    expect(t.events).toEqual([]);
  });

  it('the deadline is fixed when the turn starts (disconnecting mid-turn does not shorten it)', () => {
    const h = headsUp();
    const deadline = h.state.turn?.deadline;
    h.send({ type: 'PLAYER_CONNECTION', playerId: 'a', connected: false });
    expect(h.state.turn?.deadline).toBe(deadline);
  });
});

describe('deadline + grace boundary (uses envelope.at)', () => {
  it('accepts an action exactly at deadline + grace and rejects one 1 ms later', () => {
    const h1 = headsUp();
    const turn1 = h1.state.turn;
    if (turn1 === null) throw new Error('no turn');
    expect(h1.act({ type: 'CALL' }, { at: turn1.deadline + TIMING.actionGraceMs }).ok).toBe(true);

    const h2 = headsUp();
    const turn2 = h2.state.turn;
    if (turn2 === null) throw new Error('no turn');
    const before = h2.state.version;
    const r = h2.act({ type: 'CALL' }, { at: turn2.deadline + TIMING.actionGraceMs + 1 });
    expect(r).toMatchObject({ ok: false, code: 'ACTION_DEADLINE_PASSED', duplicate: false });
    expect(h2.state.version).toBe(before);
    // the timer then applies the timeout normally
    h2.fireTurnTimer();
    expect(h2.payloads('PLAYER_ACTED').at(-1)).toMatchObject({ playerId: 'a', timeout: true });
  });

  it('accepts an action after the visible deadline but within the grace period', () => {
    const h = headsUp();
    const turn = h.state.turn;
    if (turn === null) throw new Error('no turn');
    expect(h.act({ type: 'CALL' }, { at: turn.deadline + 1 }).ok).toBe(true);
  });

  it('once the timeout is applied, a late action is rejected (no double action)', () => {
    const h = headsUp();
    const version = h.state.turn?.turnVersion ?? null;
    h.fireTurnTimer();
    const r = h.act({ type: 'CALL' }, { playerId: 'a', version });
    expect(r.ok).toBe(false);
    expect(['NO_ACTIVE_HAND', 'PLAYER_FOLDED', 'STALE_STATE_VERSION', 'NOT_YOUR_TURN']).toContain(r.code);
  });
});

describe('admin turn controls', () => {
  it('ADMIN_FORCE_TIMEOUT applies the timeout action now', () => {
    const h = headsUp();
    const t = h.send({ type: 'ADMIN_FORCE_TIMEOUT' });
    expect(t.reply).toMatchObject({ ok: true });
    expect(t.events.find((e) => e.event.kind === 'PLAYER_ACTED')?.event).toMatchObject({
      playerId: 'a',
      action: 'FOLD',
      timeout: true,
    });
    // between hands there is nothing to time out
    expect(h.send({ type: 'ADMIN_FORCE_TIMEOUT' }).reply).toMatchObject({ ok: false, code: 'NO_ACTIVE_HAND' });
  });

  it('ADMIN_FORCE_TIMEOUT with a turnVersion only times out that exact turn', () => {
    const h = headsUp();
    const turnVersion = h.state.turn!.turnVersion;
    expect(h.send({ type: 'ADMIN_FORCE_TIMEOUT', turnVersion: turnVersion + 1 }).reply).toMatchObject({ ok: false, code: 'STALE_STATE_VERSION' });
    expect(h.state.turn!.turnVersion).toBe(turnVersion);
    const t = h.send({ type: 'ADMIN_FORCE_TIMEOUT', turnVersion });
    expect(t.reply).toMatchObject({ ok: true });
    expect(t.events.some((e) => e.event.kind === 'PLAYER_ACTED' && e.event.timeout)).toBe(true);
  });

  it('ADMIN_ADD_TIME extends the deadline, re-issues the token and keeps the turnVersion', () => {
    const h = headsUp();
    const turn = h.state.turn;
    if (turn === null) throw new Error('no turn');
    const t = h.send({ type: 'ADMIN_ADD_TIME', ms: 30_000 });
    expect(t.reply?.ok).toBe(true);
    expect(h.state.turn).toMatchObject({
      deadline: turn.deadline + 30_000,
      turnVersion: turn.turnVersion,
      addedMs: 30_000,
    });
    expect(h.state.turn?.timerToken).not.toBe(turn.timerToken);
    expect(t.events.map((e) => e.event)).toEqual([
      expect.objectContaining({
        kind: 'ACTION_REQUESTED',
        turnVersion: turn.turnVersion,
        deadline: turn.deadline + 30_000,
      }),
    ]);
    expect(t.timers).toEqual([
      { kind: 'ACTION_TIMEOUT', at: turn.deadline + 30_000 + TIMING.actionGraceMs, token: h.state.turn?.timerToken },
    ]);
    // the old timer is now stale
    expect(
      h.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: turn.timerToken }, turn.deadline + 5_000).events,
    ).toEqual([]);
    // the client's original turnVersion is still valid
    expect(h.act({ type: 'CALL' }, { version: turn.turnVersion }).ok).toBe(true);
    // validation
    expect(h.send({ type: 'ADMIN_ADD_TIME', ms: 0 }).reply?.code).toBe('INVALID_COMMAND');
    expect(h.send({ type: 'ADMIN_ADD_TIME', ms: 3_600_001 }).reply?.code).toBe('INVALID_COMMAND');
  });

  it('SET_TIMING applies to the next turn, not the running one (deadline and grace are pinned)', () => {
    const h = headsUp();
    const deadline = h.state.turn?.deadline as number;
    h.send({ type: 'SET_TIMING', timing: { ...TIMING, actionTimerMs: 30_000, actionGraceMs: 0 } });
    expect(h.state.turn?.deadline).toBe(deadline);
    expect(h.state.turn?.graceMs).toBe(TIMING.actionGraceMs);
    // still accepted within the grace that was announced when the turn started
    expect(h.act({ type: 'CALL' }, { at: deadline + TIMING.actionGraceMs }).ok).toBe(true);
    expect(h.state.turn?.graceMs).toBe(0);
    h.send({ type: 'SET_TIMING', timing: { ...TIMING, actionTimerMs: 30_000 } });
    h.foldAround();
    h.fireNextHand();
    h.act({ type: 'CALL' });
    h.act({ type: 'CALL' });
    expect(h.state.turn?.timerMs).toBe(30_000);
    expect(h.send({ type: 'SET_TIMING', timing: { ...TIMING, awayAfterTimeouts: 0 } }).reply?.code).toBe(
      'INVALID_COMMAND',
    );
  });
});

describe('freeze / unfreeze', () => {
  it('preserves the remaining action time and re-arms with a new token', () => {
    const h = headsUp();
    const turn = h.state.turn;
    if (turn === null) throw new Error('no turn');
    h.advance(4_000);
    h.send({ type: 'FREEZE' });
    expect(h.state.frozen).toEqual({
      since: h.now,
      turnRemainingMs: TIMING.actionTimerMs - 4_000,
      turnGraceRemainingMs: TIMING.actionGraceMs,
      nextHandRemainingMs: null,
    });
    expect(h.lastPayloads()).toEqual([{ kind: 'TABLE_STATUS_CHANGED', status: 'IN_HAND', holds: [], frozen: true }]);
    // actions and timers are suspended
    expect(h.act({ type: 'CALL' }).code).toBe('TABLE_FROZEN');
    const frozenState = h.state;
    expect(
      h.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: turn.timerToken }, turn.deadline + 60_000).state,
    ).toBe(frozenState);
    expect(h.send({ type: 'ADMIN_FORCE_TIMEOUT' }).reply?.code).toBe('TABLE_FROZEN');
    // a long freeze
    h.advance(600_000);
    const t = h.send({ type: 'UNFREEZE' });
    const newDeadline = h.now + TIMING.actionTimerMs - 4_000;
    expect(h.state.turn).toMatchObject({ deadline: newDeadline, turnVersion: turn.turnVersion });
    expect(h.state.turn?.timerToken).not.toBe(turn.timerToken);
    expect(t.timers).toEqual([
      { kind: 'ACTION_TIMEOUT', at: newDeadline + TIMING.actionGraceMs, token: h.state.turn?.timerToken },
    ]);
    expect(t.events.map((e) => e.event.kind)).toEqual(['ACTION_REQUESTED', 'TABLE_STATUS_CHANGED']);
    expect(h.state.frozen).toBeNull();
    // the old token stays stale (its original due time passed long ago)
    expect(h.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: turn.timerToken }).events).toEqual([]);
    expect(h.act({ type: 'CALL' }).ok).toBe(true);
  });

  it('preserves a pending NEXT_HAND delay', () => {
    const h = headsUp();
    h.foldAround();
    const next = h.state.nextHand;
    if (next === null) throw new Error('no next hand');
    h.advance(1_000);
    h.send({ type: 'FREEZE' });
    const remaining = next.dueAt - h.now;
    expect(h.state.frozen?.nextHandRemainingMs).toBe(remaining);
    expect(h.send({ type: 'TIMER_FIRED', kind: 'NEXT_HAND', token: next.token }, next.dueAt).events).toEqual([]);
    h.advance(50_000);
    const t = h.send({ type: 'UNFREEZE' });
    expect(h.state.nextHand?.dueAt).toBe(h.now + remaining);
    expect(t.timers).toEqual([{ kind: 'NEXT_HAND', at: h.state.nextHand?.dueAt, token: h.state.nextHand?.token }]);
    h.fireNextHand();
    expect(h.state.status).toBe('IN_HAND');
  });

  it('FREEZE/UNFREEZE are idempotent', () => {
    const h = headsUp();
    expect(h.send({ type: 'UNFREEZE' }).reply).toMatchObject({ ok: true, message: 'not frozen' });
    h.send({ type: 'FREEZE' });
    expect(h.send({ type: 'FREEZE' }).reply).toMatchObject({ ok: true, message: 'already frozen' });
  });

  it('START while frozen defers the first deal until UNFREEZE', () => {
    const h = new Harness();
    h.seat('a', 0);
    h.seat('b', 1);
    h.send({ type: 'FREEZE' });
    h.start();
    expect(h.state.status).toBe('BETWEEN_HANDS');
    expect(h.state.frozen?.nextHandRemainingMs).toBe(0);
    expect(h.last?.timers).toEqual([]);
    h.send({ type: 'UNFREEZE' });
    h.fireNextHand();
    expect(h.state.status).toBe('IN_HAND');
  });

  it('ADMIN_ADD_TIME while frozen adds to the preserved time', () => {
    const h = headsUp();
    h.send({ type: 'FREEZE' });
    h.send({ type: 'ADMIN_ADD_TIME', ms: 10_000 });
    expect(h.state.frozen?.turnRemainingMs).toBe(TIMING.actionTimerMs + 10_000);
    h.send({ type: 'UNFREEZE' });
    expect(h.state.turn?.deadline).toBe(h.now + TIMING.actionTimerMs + 10_000);
  });
});
