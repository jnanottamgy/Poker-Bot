import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { adminView, playerView, spectatorView } from '../src';
import { Harness, TIMING } from './helpers';
import { assertViewPrivacy, simulate } from './sim';

function showdownTable(): Harness {
  const h = new Harness({ initialButtonSeat: 0 });
  h.seat('a', 0, 5_000);
  h.seat('b', 1, 5_000);
  h.seat('c', 2, 5_000);
  // c holds the nuts, a a loser that will muck when b shows a better hand, b shows.
  h.rigNextHand({ 0: ['7c', '2d'], 1: ['Kh', 'Kc'], 2: ['As', 'Ah'] }, ['Ad', 'Kd', '9s', '5h', '3c']);
  return h;
}

describe('views', () => {
  it('player view: own hole cards only, legal actions only on own turn, null for strangers', () => {
    const h = showdownTable();
    h.start(); // button 0 acts first
    const va = playerView(h.state, 'a', h.now);
    const vb = playerView(h.state, 'b', h.now);
    expect(va?.you).toMatchObject({ playerId: 'a', seat: 0, holeCards: ['7c', '2d'] });
    expect(va?.you.legal).toMatchObject({ seat: 0, canCall: true, callAmount: 100 });
    expect(vb?.you).toMatchObject({ seat: 1, holeCards: ['Kh', 'Kc'], legal: null });
    expect(JSON.stringify(vb)).not.toContain('"7c"');
    expect(JSON.stringify(vb)).not.toContain('"As"');
    expect(playerView(h.state, 'nobody', h.now)).toBeNull();
    expect(va?.audience).toBe('PLAYER');
    expect(va?.hand).toMatchObject({
      handId: 'T1:1',
      phase: 'PREFLOP',
      board: [],
      totalPot: 150,
      currentBet: 100,
      actingSeat: 0,
      turnVersion: h.state.turn?.turnVersion,
    });
    expect(va?.hand?.actionDeadline).toBe(h.state.turn?.deadline);
    expect(va?.seats[1]).toMatchObject({ isSmallBlind: true, streetContribution: 50, stack: 4_950, inHand: true });
    expect(va?.seats[0]).toMatchObject({ isButton: true, isSmallBlind: false, isBigBlind: false });
    expect(va?.serverTime).toBe(h.now);
    expect(va?.lastEventSeq).toBe(h.events.at(-1)?.seq);
    // frozen: no legal actions offered
    h.send({ type: 'FREEZE' });
    expect(playerView(h.state, 'a', h.now)?.you.legal).toBeNull();
    expect(playerView(h.state, 'a', h.now)?.frozen).toBe(true);
  });

  it('spectators never see hole cards before showdown; revealed cards are public after it, mucked cards stay hidden', () => {
    const h = showdownTable();
    h.start();
    const pre = JSON.stringify(spectatorView(h.state, h.now));
    for (const c of ['7c', '2d', 'Kh', 'Kc', 'As', 'Ah']) expect(pre).not.toContain(`"${c}"`);
    // everyone checks/calls down
    while (h.state.turn !== null) {
      const legal = h.legal();
      h.act(legal.canCheck ? { type: 'CHECK' } : { type: 'CALL' });
    }
    const reveals = h.payloads('SHOWDOWN')[0]?.reveals ?? [];
    const shown = Object.fromEntries(reveals.map((r) => [r.seat, r.cards]));
    const sv = spectatorView(h.state, h.now);
    expect(sv.hand).toMatchObject({
      phase: 'HAND_COMPLETE',
      board: ['Ad', 'Kd', '9s', '5h', '3c'],
      actingSeat: null,
      currentBet: 0,
    });
    for (const seat of [0, 1, 2]) expect(sv.seats[seat]?.shownCards ?? null).toEqual(shown[seat] ?? null);
    expect(sv.seats[2]?.shownCards).toEqual(['As', 'Ah']); // the winner is always shown
    const mucked = reveals.filter((r) => r.mucked).map((r) => r.seat);
    for (const seat of mucked) {
      const cards = h.state.hand?.players.find((p) => p.seat === seat)?.holeCards ?? [];
      for (const c of cards) expect(JSON.stringify(sv)).not.toContain(`"${c}"`);
    }
    expect(sv.hand?.totalPot).toBe(300);
    expect(sv.hand?.pots).toEqual([{ amount: 300, eligibleSeats: [0, 1, 2] }]);
  });

  it('a fold win shows nothing', () => {
    const h = showdownTable();
    h.start();
    h.foldAround();
    const sv = JSON.stringify(spectatorView(h.state, h.now));
    for (const c of ['7c', '2d', 'Kh', 'Kc', 'As', 'Ah']) expect(sv).not.toContain(`"${c}"`);
  });

  it('player stack is live during the hand', () => {
    const h = showdownTable();
    h.start();
    h.act({ type: 'RAISE', amount: 300 });
    const v = spectatorView(h.state, h.now);
    expect(v.seats[0]).toMatchObject({
      stack: 4_700,
      streetContribution: 300,
      lastAction: { action: 'RAISE', amount: 300, toAmount: 300 },
    });
    expect(v.hand?.totalPot).toBe(450);
  });

  it('admin view: hole cards only with VIEW_HOLE_CARDS, plus full table internals', () => {
    const h = showdownTable();
    h.send({ type: 'SET_HAND_FOR_HAND', enabled: false });
    h.start();
    h.send({ type: 'SET_BLINDS', blinds: { level: 2, smallBlind: 100, bigBlind: 200, ante: 0, anteType: 'NONE' } });
    h.send({ type: 'PLAYER_CONNECTION', playerId: 'b', connected: false });
    expect(adminView(h.state, h.now, { includeHoleCards: false }).holeCards).toBeNull();
    const av = adminView(h.state, h.now, { includeHoleCards: true });
    expect(av.holeCards).toEqual({ 0: ['7c', '2d'], 1: ['Kh', 'Kc'], 2: ['As', 'Ah'] });
    expect(av).toMatchObject({
      audience: 'ADMIN',
      timing: TIMING,
      handForHand: false,
      pendingBlinds: { level: 2, bigBlind: 200 },
      handsPlayed: 0,
      started: true,
      nextHandAt: null,
      freeze: null,
      turn: { seat: 0, playerId: 'a', timerMs: TIMING.actionTimerMs, away: false, addedMs: 0 },
      positions: {
        lastButtonSeat: 0,
        lastSmallBlindSeat: 1,
        lastBigBlindSeat: 2,
        next: { buttonSeat: 1, smallBlindPosition: 2, smallBlindPosted: true, bigBlindSeat: 0, headsUp: false },
      },
      handDeckHash: h.state.handMeta?.deckHash,
      clock: h.now,
    });
    expect(av.turn?.hardDeadline).toBe((av.turn?.deadline ?? 0) + TIMING.actionGraceMs);
    expect(av.seatDetails[1]).toMatchObject({
      seat: 1,
      playerId: 'b',
      connected: false,
      stack: 4_950,
      consecutiveTimeouts: 0,
      waitingForNextHand: false,
    });
    expect(av.seats[1]?.away).toBe(true);
    expect(av.handActionLog?.map((e) => e.kind)).toEqual(['FORCED_BET', 'FORCED_BET']);
    h.foldAround();
    const after = adminView(h.state, h.now, { includeHoleCards: false });
    // folded to the BB: the unmatched 50 of the big blind is returned, the pot awarded is 100
    expect(after.counters).toMatchObject({ handsPlayed: 1, largestPot: 100, playersSeated: 3 });
    expect(after.recentHands).toEqual([
      expect.objectContaining({
        handId: 'T1:1',
        handNumber: 1,
        totalPot: 100,
        showdown: false,
        winners: [{ seat: 2, playerId: 'c', amount: 100 }],
      }),
    ]);
    expect(after.nextHandAt).toBe(h.state.nextHand?.dueAt);
  });

  it('views never alias the state', () => {
    const h = showdownTable();
    h.start();
    const before = JSON.stringify(h.state);
    const av = adminView(h.state, h.now, { includeHoleCards: true });
    const pv = playerView(h.state, 'a', h.now);
    const detail = av.seatDetails[0];
    if (detail) detail.stats.handsPlayedTotal = 999;
    av.timing.actionTimerMs = 1;
    av.holds.push('PAUSE');
    pv?.you.holeCards?.reverse();
    pv?.hand?.board.push('2c');
    expect(JSON.stringify(h.state)).toBe(before);
  });

  it('property: random states never leak hole cards in any view', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const { h } = simulate({ seed, hands: 10, checkViews: true });
        assertViewPrivacy(h.state, h.now);
      }),
      { numRuns: 15 },
    );
  });
});
