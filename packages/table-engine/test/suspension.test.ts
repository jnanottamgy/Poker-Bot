import { describe, expect, it } from 'vitest';
import { Harness } from './helpers';

function headsUp(): Harness {
  const h = new Harness({ initialButtonSeat: 0 });
  h.seat('a', 0);
  h.seat('b', 1);
  h.start();
  return h;
}

describe('SET_SUSPENDED (admin sanction)', () => {
  it('suspending the acting player applies the timeout at once', () => {
    const h = headsUp();
    const acting = h.state.turn!.playerId;
    const before = h.state.hand!;
    const t = h.send({ type: 'SET_SUSPENDED', playerId: acting, suspended: true });
    expect(t.reply?.ok).toBe(true);
    expect(h.state.seats.find((o) => o?.playerId === acting)?.suspended).toBe(true);
    expect(h.state.hand).not.toBe(before);
    const acted = t.events.find((e) => e.event.kind === 'PLAYER_ACTED');
    expect(acted?.event).toMatchObject({ playerId: acting, timeout: true });
  });

  it('a suspended player cannot act and gets zero time on later decisions', () => {
    const h = headsUp();
    const other = h.state.turn!.playerId === 'a' ? 'b' : 'a';
    expect(h.send({ type: 'SET_SUSPENDED', playerId: other, suspended: true }).reply?.ok).toBe(true);
    // play until the suspended player is asked to act
    for (let i = 0; i < 20 && h.state.turn?.playerId !== other; i++) {
      if (h.state.turn) h.act({ type: 'CALL' });
      else if (h.state.nextHand) h.fireNextHand();
    }
    const turn = h.state.turn!;
    expect(turn.playerId).toBe(other);
    expect(turn.deadline).toBe(h.now);
    expect(turn.graceMs).toBe(0);
    expect(h.act({ type: 'FOLD' }, { playerId: other }).code).toBe('PLAYER_SUSPENDED');
    const t = h.fireTurnTimer();
    expect(t.events.find((e) => e.event.kind === 'PLAYER_ACTED')?.event).toMatchObject({ playerId: other, timeout: true });
  });

  it('restoring lifts the sanction; unknown players are rejected', () => {
    const h = headsUp();
    const other = h.state.turn!.playerId === 'a' ? 'b' : 'a';
    h.send({ type: 'SET_SUSPENDED', playerId: other, suspended: true });
    h.send({ type: 'SET_SUSPENDED', playerId: other, suspended: false });
    expect(h.state.seats.find((o) => o?.playerId === other)?.suspended).toBe(false);
    expect(h.send({ type: 'SET_SUSPENDED', playerId: 'zzz', suspended: true }).reply?.code).toBe('PLAYER_NOT_SEATED');
  });
});
