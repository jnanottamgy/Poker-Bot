/**
 * ADVERSARIAL (timers). Deadline + grace boundary measured with envelope.at,
 * stale and premature tokens, away timers, freeze/unfreeze of the remaining
 * time, ADMIN_ADD_TIME, SET_TIMING pinning (CONTRACTS §4 Turn validation,
 * Timers, Freeze; README contract notes 4-6).
 */
import { describe, expect, it } from 'vitest';
import { Harness, TIMING } from './helpers';

/** Heads-up table: 'a' on seat 0 is button/SB and acts first preflop; 'b' on seat 1 is the BB. */
function headsUp(timing = TIMING): Harness {
  const h = new Harness({ initialButtonSeat: 0, timing });
  h.seat('a', 0);
  h.seat('b', 1);
  h.start();
  return h;
}

function turnOf(h: Harness) {
  const t = h.state.turn;
  if (t === null) throw new Error('nobody is acting');
  return t;
}

describe('adversarial-table: deadline + grace boundary (envelope.at)', () => {
  it('ACTION_TIMEOUT 1 ms early is premature (state untouched, same timer re-requested); at the cutoff it applies', () => {
    const h = headsUp();
    const turn = turnOf(h);
    const cutoff = turn.deadline + TIMING.actionGraceMs;
    const before = h.state;
    const early = h.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: turn.timerToken }, cutoff - 1);
    expect(early.state).toBe(before);
    expect(early.events).toEqual([]);
    expect(early.reply).toBeNull();
    expect(early.timers).toEqual([{ kind: 'ACTION_TIMEOUT', at: cutoff, token: turn.timerToken }]);
    const due = h.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: turn.timerToken }, cutoff);
    expect(due.state.version).toBe(before.version + 1);
    expect(due.events.find((e) => e.event.kind === 'PLAYER_ACTED')?.event).toMatchObject({
      playerId: 'a',
      action: 'FOLD',
      timeout: true,
    });
  });

  it('after a premature timer the player can still act up to the cutoff, and not 1 ms after', () => {
    const h = headsUp();
    const turn = turnOf(h);
    const cutoff = turn.deadline + TIMING.actionGraceMs;
    h.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: turn.timerToken }, cutoff - 500);
    expect(h.act({ type: 'CALL' }, { at: cutoff + 1 })).toMatchObject({ ok: false, code: 'ACTION_DEADLINE_PASSED' });
    // rejected commands and premature timers do not move the table clock
    expect(h.state.clock).toBe(turn.requestedAt);
    expect(h.act({ type: 'CALL' }, { at: cutoff, actionId: 'retry-new-id' }).ok).toBe(true);
  });

  it('a zero grace makes the visible deadline the hard cutoff', () => {
    const h = headsUp({ ...TIMING, actionGraceMs: 0 });
    const turn = turnOf(h);
    expect(h.last?.timers.at(-1)).toEqual({ kind: 'ACTION_TIMEOUT', at: turn.deadline, token: turn.timerToken });
    expect(h.act({ type: 'CALL' }, { at: turn.deadline + 1 }).code).toBe('ACTION_DEADLINE_PASSED');
    expect(h.act({ type: 'CALL' }, { at: turn.deadline, actionId: 'ok-1' }).ok).toBe(true);
  });
});

describe('adversarial-table: stale tokens', () => {
  it('the token of a previous decision of the SAME player never fires on the new decision', () => {
    const h = headsUp();
    h.act({ type: 'CALL' }); // a completes; b (BB) to act preflop
    const preflop = turnOf(h);
    expect(preflop.playerId).toBe('b');
    h.act({ type: 'CHECK' }); // flop: b acts first heads-up
    const flop = turnOf(h);
    expect(flop.playerId).toBe('b');
    expect(flop.timerToken).not.toBe(preflop.timerToken);
    const before = h.state;
    const stale = h.send(
      { type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: preflop.timerToken },
      flop.deadline + flop.graceMs + 10,
    );
    expect(stale.state).toBe(before);
    expect(stale.events).toEqual([]);
    expect(stale.timers).toEqual([]);
    // the live token applies a CHECK timeout for b
    h.fireTurnTimer();
    expect(h.payloads('PLAYER_ACTED').at(-1)).toMatchObject({ playerId: 'b', action: 'CHECK', timeout: true });
  });

  it('a timer of the right token but the wrong kind is ignored', () => {
    const h = headsUp();
    const turn = turnOf(h);
    const before = h.state;
    const t = h.send({ type: 'TIMER_FIRED', kind: 'NEXT_HAND', token: turn.timerToken }, turn.deadline + 60_000);
    expect(t.state).toBe(before);
    const h2 = headsUp();
    h2.foldAround();
    const next = h2.state.nextHand;
    if (next === null) throw new Error('no next hand');
    const b2 = h2.state;
    expect(h2.send({ type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: next.token }, next.dueAt + 1).state).toBe(b2);
  });

  it('NEXT_HAND tokens issued before a HOLD/RELEASE cycle are stale; the new one deals', () => {
    const h = headsUp();
    h.foldAround();
    const first = h.state.nextHand;
    if (first === null) throw new Error('no next hand');
    h.send({ type: 'HOLD', reason: 'PAUSE' });
    h.send({ type: 'RELEASE', reason: 'PAUSE' });
    const second = h.state.nextHand;
    if (second === null) throw new Error('no next hand after release');
    expect(second.token).not.toBe(first.token);
    expect(second.dueAt).toBe(h.now + TIMING.betweenHandsDelayMs);
    const before = h.state;
    expect(h.send({ type: 'TIMER_FIRED', kind: 'NEXT_HAND', token: first.token }, second.dueAt).state).toBe(before);
    h.fireNextHand();
    expect(h.state.status).toBe('IN_HAND');
    expect(h.state.handNumber).toBe(2);
  });

  it('after UNFREEZE the pre-freeze token is stale even when delivered after the new due time', () => {
    const h = headsUp();
    const turn = turnOf(h);
    h.send({ type: 'FREEZE' }, h.now + 1_000);
    h.send({ type: 'UNFREEZE' }, h.now + 5_000);
    const re = turnOf(h);
    const before = h.state;
    const t = h.send(
      { type: 'TIMER_FIRED', kind: 'ACTION_TIMEOUT', token: turn.timerToken },
      re.deadline + re.graceMs + 1,
    );
    expect(t.state).toBe(before);
  });
});

describe('adversarial-table: away timers', () => {
  it('after awayAfterTimeouts consecutive timeouts the next decision uses the away timer (exact numbers)', () => {
    const h = headsUp();
    // hand 1: a (button/SB) times out -> FOLD (1)
    h.fireTurnTimer();
    h.fireNextHand(); // hand 2: b button/SB acts first, a is BB
    h.act({ type: 'CALL' });
    const t2 = h.fireTurnTimer(); // a checks by timeout (2) -> flop: a (non-button) acts first heads-up
    const req = t2.events.flatMap((e) => (e.event.kind === 'ACTION_REQUESTED' ? [e.event] : []));
    expect(req).toHaveLength(1);
    expect(req[0]).toMatchObject({ playerId: 'a', timerMs: TIMING.awayActionTimerMs, deadline: h.now + 5_000 });
    expect(turnOf(h)).toMatchObject({ playerId: 'a', away: true, timerMs: 5_000 });
    expect(h.occupant('a')?.consecutiveTimeouts).toBe(2);
    // freeze 1.5 s into the away turn: 3.5 s are preserved
    h.send({ type: 'FREEZE' }, h.now + 1_500);
    expect(h.state.frozen?.turnRemainingMs).toBe(3_500);
    h.send({ type: 'UNFREEZE' }, h.now + 120_000);
    expect(turnOf(h).deadline).toBe(h.now + 3_500);
    // a voluntary action resets the counter: a's next decision gets the full timer again
    h.act({ type: 'CHECK' });
    expect(h.occupant('a')?.consecutiveTimeouts).toBe(0);
    h.act({ type: 'CHECK' }); // b checks -> turn: a first
    expect(turnOf(h)).toMatchObject({ playerId: 'a', away: false, timerMs: TIMING.actionTimerMs });
  });
});

describe('adversarial-table: freeze / unfreeze keeps the exact remaining time', () => {
  it('two freeze cycles and an ADMIN_ADD_TIME in between add up exactly; turnVersion survives', () => {
    const h = headsUp();
    const turn = turnOf(h);
    const legalBefore = h.legal();
    h.send({ type: 'FREEZE' }, turn.requestedAt + 4_000); // 11 000 left
    h.send({ type: 'ADMIN_ADD_TIME', ms: 2_500 }, h.now + 10); // 13 500 left
    const u1 = h.send({ type: 'UNFREEZE' }, h.now + 100_000);
    expect(turnOf(h).deadline).toBe(h.now + 13_500);
    const reReq = u1.events.find((e) => e.event.kind === 'ACTION_REQUESTED')?.event;
    expect(reReq).toMatchObject({ turnVersion: turn.turnVersion, timerMs: 13_500, legal: legalBefore });
    h.send({ type: 'FREEZE' }, h.now + 3_000); // 10 500 left
    expect(h.state.frozen?.turnRemainingMs).toBe(10_500);
    h.send({ type: 'UNFREEZE' }, h.now + 7);
    const final = turnOf(h);
    expect(final.deadline).toBe(h.now + 10_500);
    expect(final.addedMs).toBe(2_500);
    expect(final.turnVersion).toBe(turn.turnVersion);
    // the client still echoes the original turnVersion
    expect(h.act({ type: 'CALL' }, { version: turn.turnVersion, at: final.deadline + final.graceMs }).ok).toBe(true);
  });

  it('BUG freeze grants a fresh grace window: a player whose hard cutoff had already passed can act after UNFREEZE', () => {
    // The ACTION_TIMEOUT timer is due at deadline + grace but the host has not delivered it yet
    // when the emergency FREEZE arrives. The player had NO time left (CONTRACTS §4: actions with
    // at > deadline + grace are rejected). Freezing must preserve that, not hand out a new grace.
    const h = headsUp();
    const turn = turnOf(h);
    const cutoff = turn.deadline + TIMING.actionGraceMs;
    expect(h.act({ type: 'CALL' }, { at: cutoff + 400, actionId: 'too-late' }).code).toBe('ACTION_DEADLINE_PASSED');
    h.send({ type: 'FREEZE' }, cutoff + 500);
    const u = h.send({ type: 'UNFREEZE' }, cutoff + 60_000);
    const unfreezeAt = h.now;
    // The timeout must be due immediately (no remaining time) ...
    expect(u.timers.find((t) => t.kind === 'ACTION_TIMEOUT')?.at).toBe(unfreezeAt);
    // ... and the late player must still be out of time.
    expect(h.act({ type: 'CALL' }, { at: unfreezeAt + 500, actionId: 'after-unfreeze' }).code).toBe(
      'ACTION_DEADLINE_PASSED',
    );
  });

  it('BUG freeze grants a fresh grace window: freezing inside the grace period preserves only the grace that was left', () => {
    const h = headsUp();
    const turn = turnOf(h);
    const cutoff = turn.deadline + TIMING.actionGraceMs; // grace 1000
    h.send({ type: 'FREEZE' }, turn.deadline + 600); // 400 ms of hard time left
    h.send({ type: 'UNFREEZE' }, turn.deadline + 50_000);
    const t = turnOf(h);
    // hard cutoff after UNFREEZE = now + 400 (what was left), not now + a full new grace
    expect(t.deadline + t.graceMs).toBe(h.now + (cutoff - (turn.deadline + 600)));
  });
});

describe('adversarial-table: SET_TIMING never changes the cutoff of a running turn (README note 6)', () => {
  it('BUG grace re-pinned by ADMIN_ADD_TIME: after SET_TIMING(grace 0), adding time silently removes the turn’s grace', () => {
    const h = headsUp();
    const turn = turnOf(h);
    h.send({ type: 'SET_TIMING', timing: { ...TIMING, actionGraceMs: 0 } });
    expect(turnOf(h).graceMs).toBe(TIMING.actionGraceMs); // pinned ...
    const t = h.send({ type: 'ADMIN_ADD_TIME', ms: 5_000 });
    const newDeadline = turn.deadline + 5_000;
    expect(turnOf(h).deadline).toBe(newDeadline);
    // ... and must stay pinned for this turn: the cutoff only moves by the added time.
    expect(turnOf(h).graceMs).toBe(TIMING.actionGraceMs);
    expect(t.timers).toEqual([
      { kind: 'ACTION_TIMEOUT', at: newDeadline + TIMING.actionGraceMs, token: turnOf(h).timerToken },
    ]);
    expect(h.act({ type: 'CALL' }, { at: newDeadline + TIMING.actionGraceMs }).ok).toBe(true);
  });

  it('BUG grace re-pinned by UNFREEZE: SET_TIMING while frozen changes the running turn’s cutoff', () => {
    const h = headsUp();
    const turn = turnOf(h);
    h.send({ type: 'FREEZE' }, turn.requestedAt + 1_000);
    h.send({ type: 'SET_TIMING', timing: { ...TIMING, actionGraceMs: 30_000 } });
    h.send({ type: 'UNFREEZE' }, h.now + 1_000);
    const t = turnOf(h);
    expect(t.deadline).toBe(h.now + TIMING.actionTimerMs - 1_000);
    expect(t.graceMs).toBe(TIMING.actionGraceMs);
  });
});
