import { commitmentFor, createDeckProvider, verifyHand } from '@jpb/fairness-engine';
import { sha256Hex } from '@jpb/randomness';
import { describe, expect, it } from 'vitest';
import { handFairnessRecord, lastHandHistory } from '../src';
import { BLINDS, Harness, riggedDeck, T0, TIMING } from './helpers';

/** 3-handed table: seats 0, 3, 6, button 0 -> SB 3, BB 6. */
function threeHanded(): Harness {
  const h = new Harness({ initialButtonSeat: 0 });
  h.seat('alice', 0, 5_000);
  h.seat('bob', 3, 5_000);
  h.seat('carol', 6, 5_000);
  return h;
}

describe('a full hand driven by commands', () => {
  it('deals, prompts, plays every street to showdown and reports the result', () => {
    const h = threeHanded();
    h.rigNextHand({ 0: ['As', 'Kd'], 3: ['Qh', 'Qc'], 6: ['7s', '2c'] }, ['Ah', '9d', '4c', 'Js', '3h']);
    h.advance(10);
    const start = h.start();
    const kinds = start.events.map((e) => e.event.kind);
    expect(kinds).toEqual([
      'TABLE_STATUS_CHANGED',
      'HAND_STARTED',
      'FORCED_BET_POSTED',
      'FORCED_BET_POSTED',
      'HOLE_CARDS_DEALT',
      'HOLE_CARDS_DEALT',
      'HOLE_CARDS_DEALT',
      'ACTION_REQUESTED',
    ]);
    // TURN_TO_ACT never leaves the table engine.
    expect(h.events.some((e) => e.event.kind === 'TURN_TO_ACT')).toBe(false);
    // Hole cards are private to their owner; dealt first to the seat after the button.
    const dealt = start.events.filter((e) => e.event.kind === 'HOLE_CARDS_DEALT');
    expect(dealt.map((e) => [e.visibility, e.privateTo])).toEqual([
      ['PRIVATE', 'bob'],
      ['PRIVATE', 'carol'],
      ['PRIVATE', 'alice'],
    ]);
    expect(
      start.events
        .filter((e) => e.event.kind !== 'HOLE_CARDS_DEALT')
        .every((e) => e.visibility === 'PUBLIC' && e.privateTo === null),
    ).toBe(true);

    // ACTION_REQUESTED: alice (button, UTG 3-handed), deadline = at + actionTimerMs; timer at deadline + grace.
    const req = start.events.at(-1)?.event;
    expect(req).toMatchObject({
      kind: 'ACTION_REQUESTED',
      seat: 0,
      playerId: 'alice',
      deadline: T0 + 10 + TIMING.actionTimerMs,
      timerMs: TIMING.actionTimerMs,
      turnVersion: h.state.version,
    });
    expect(start.timers).toEqual([
      {
        kind: 'ACTION_TIMEOUT',
        at: T0 + 10 + TIMING.actionTimerMs + TIMING.actionGraceMs,
        token: h.state.turn?.timerToken,
      },
    ]);

    expect(h.act({ type: 'RAISE', amount: 300 })).toMatchObject({ ok: true, code: null, duplicate: false });
    expect(h.act({ type: 'CALL' }).ok).toBe(true); // bob
    expect(h.act({ type: 'FOLD' }).ok).toBe(true); // carol
    // flop: bob first after the button
    expect(h.state.turn?.playerId).toBe('bob');
    h.act({ type: 'CHECK' });
    h.act({ type: 'BET', amount: 400 }); // alice
    h.act({ type: 'CALL' }); // bob
    h.act({ type: 'CHECK' }); // turn bob
    h.act({ type: 'CHECK' }); // alice
    h.act({ type: 'CHECK' }); // river bob
    h.advance(500);
    const last = h.send({
      type: 'PLAYER_ACTION',
      actionId: 'final',
      playerId: 'alice',
      intent: { type: 'CHECK' },
      tableStateVersion: h.state.turn?.turnVersion ?? null,
    });
    const tail = last.events.map((e) => e.event.kind);
    expect(tail).toEqual([
      'PLAYER_ACTED',
      'BETTING_ROUND_COMPLETE',
      'SHOWDOWN',
      'POT_AWARDED',
      'HAND_COMPLETED',
      'HAND_RESULT',
      'TABLE_STATUS_CHANGED',
    ]);

    const result = h.payloads('HAND_RESULT')[0]?.result;
    expect(result).toMatchObject({
      tableId: 'T1',
      handId: 'T1:1',
      handNumber: 1,
      buttonSeat: 0,
      smallBlindSeat: 3,
      smallBlindPosition: 3,
      bigBlindSeat: 6,
      showdown: true,
      busted: [],
      largestPot: 300 + 300 + 100 + 400 + 400,
      totalChipsAtTable: 15_000,
      completedAt: h.now,
      startedAt: T0 + 10,
    });
    // Alice wins with a pair of aces.
    expect(result?.players).toEqual([
      expect.objectContaining({ playerId: 'alice', seat: 0, startingStack: 5_000, finalStack: 5_000 + 700 + 100 }),
      expect.objectContaining({ playerId: 'bob', seat: 3, startingStack: 5_000, finalStack: 5_000 - 700 }),
      expect.objectContaining({ playerId: 'carol', seat: 6, startingStack: 5_000, finalStack: 5_000 - 100 }),
    ]);
    // Stacks synced to seats, status BETWEEN_HANDS with NEXT_HAND after betweenHands + showdown delay.
    expect(h.occupant('alice')?.stack).toBe(5_800);
    expect(h.state.status).toBe('BETWEEN_HANDS');
    expect(h.state.nextHand?.dueAt).toBe(h.now + TIMING.betweenHandsDelayMs + TIMING.showdownDelayMs);
    expect(last.timers).toEqual([{ kind: 'NEXT_HAND', at: h.now + 5_000, token: h.state.nextHand?.token }]);
    expect(h.state.counters).toMatchObject({ handsPlayed: 1, largestPot: 1_500, totalPotChips: 1_500, showdowns: 1 });
  });

  it('updates position stats per dealt hand (BB / SB resets, totals)', () => {
    const h = threeHanded();
    h.start(); // button 0, SB 3, BB 6
    h.foldAround();
    const report = h.payloads('HAND_RESULT')[0]?.result;
    const stats = Object.fromEntries((report?.players ?? []).map((p) => [p.playerId, p.stats]));
    expect(stats.alice).toEqual({
      handsDealtAtTable: 1,
      handsSinceBigBlind: 1,
      handsSinceSmallBlind: 1,
      handsPlayedTotal: 1,
    });
    expect(stats.bob).toEqual({
      handsDealtAtTable: 1,
      handsSinceBigBlind: 1,
      handsSinceSmallBlind: 0,
      handsPlayedTotal: 1,
    });
    expect(stats.carol).toEqual({
      handsDealtAtTable: 1,
      handsSinceBigBlind: 0,
      handsSinceSmallBlind: 1,
      handsPlayedTotal: 1,
    });
    h.fireNextHand(); // button 3, SB 6, BB 0
    h.foldAround();
    expect(h.occupant('alice')?.stats).toEqual({
      handsDealtAtTable: 2,
      handsSinceBigBlind: 0,
      handsSinceSmallBlind: 2,
      handsPlayedTotal: 2,
    });
    expect(h.occupant('carol')?.stats).toEqual({
      handsDealtAtTable: 2,
      handsSinceBigBlind: 1,
      handsSinceSmallBlind: 0,
      handsPlayedTotal: 2,
    });
  });

  it('carries stats in from SEAT_PLAYER and out in PLAYER_REMOVED', () => {
    const h = new Harness();
    h.seat('a', 0);
    h.seat('b', 1, 10_000, {
      stats: { handsDealtAtTable: 0, handsSinceBigBlind: 7, handsSinceSmallBlind: 6, handsPlayedTotal: 40 },
    });
    h.start(); // HU first hand: button/SB 0, BB 1
    h.send({ type: 'REMOVE_PLAYER', playerId: 'b', reason: 'MOVED', moveId: 'M1' });
    expect(h.occupant('b')?.pendingRemoval).toEqual({ reason: 'MOVED', moveId: 'M1' });
    h.foldAround();
    const removed = h.payloads('PLAYER_REMOVED')[0];
    expect(removed).toMatchObject({
      playerId: 'b',
      reason: 'MOVED',
      moveId: 'M1',
      seat: 1,
      stack: h.payloads('HAND_RESULT')[0]?.result.players.find((p) => p.playerId === 'b')?.finalStack,
      stats: { handsDealtAtTable: 1, handsSinceBigBlind: 0, handsSinceSmallBlind: 7, handsPlayedTotal: 41 },
    });
  });

  it('heads-up: the button posts the small blind, acts first preflop and last postflop', () => {
    const h = new Harness({ initialButtonSeat: 4 });
    h.seat('btn', 4);
    h.seat('bb', 7);
    h.start();
    const started = h.payloads('HAND_STARTED')[0];
    expect(started).toMatchObject({ buttonSeat: 4, smallBlindSeat: 4, bigBlindSeat: 7 });
    expect(h.state.turn?.playerId).toBe('btn');
    h.act({ type: 'CALL' });
    expect(h.state.turn?.playerId).toBe('bb');
    h.act({ type: 'CHECK' });
    expect(h.state.turn?.playerId).toBe('bb'); // flop: BB first
    h.act({ type: 'CHECK' });
    expect(h.state.turn?.playerId).toBe('btn');
    h.act({ type: 'CHECK' });
    expect(h.state.hand?.phase).toBe('TURN');
    expect(h.state.turn?.playerId).toBe('bb');
  });

  it('a hand that needs no decision (all-in from the blinds) completes inside the command that dealt it', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('short', 0, 50);
    h.seat('tiny', 1, 100);
    h.rigNextHand({ 0: ['As', 'Ad'], 1: ['7c', '2h'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    const t = h.start();
    const kinds = t.events.map((e) => e.event.kind);
    expect(kinds).toContain('HAND_COMPLETED');
    expect(kinds).not.toContain('ACTION_REQUESTED');
    expect(kinds.slice(-3)).toEqual(['HAND_COMPLETED', 'HAND_RESULT', 'TABLE_STATUS_CHANGED']);
    expect(kinds.filter((k) => k === 'TABLE_STATUS_CHANGED')).toHaveLength(2); // IN_HAND, then BETWEEN_HANDS
    // The SB (button, 50) wins 100: the BB's unmatched 50 came back first.
    expect(h.occupant('short')?.stack).toBe(100);
    expect(h.occupant('tiny')?.stack).toBe(50);
    expect(h.state.status).toBe('BETWEEN_HANDS');
  });

  it('busted players are removed with reason ELIMINATED and the table waits with one player left', () => {
    const h = new Harness({ initialButtonSeat: 0 });
    h.seat('winner', 0, 5_000);
    h.seat('loser', 1, 2_000);
    h.rigNextHand({ 0: ['As', 'Ad'], 1: ['7c', '2h'] }, ['Kd', 'Qc', '9s', '5h', '3c']);
    h.start();
    h.playAllInHand('loser', 'winner');
    const report = h.payloads('HAND_RESULT')[0]?.result;
    expect(report?.busted).toEqual([{ playerId: 'loser', seat: 1, startingStack: 2_000 }]);
    expect(h.payloads('PLAYER_REMOVED')).toEqual([
      {
        kind: 'PLAYER_REMOVED',
        seat: 1,
        playerId: 'loser',
        reason: 'ELIMINATED',
        stack: 0,
        moveId: null,
        stats: expect.any(Object),
      },
    ]);
    expect(h.state.status).toBe('WAITING');
    expect(h.state.nextHand).toBeNull();
    expect(h.occupant('winner')?.stack).toBe(7_000);
    expect(h.state.counters.eliminations).toBe(1);
  });

  it('records a complete hand history and a verifiable fairness record', () => {
    const serverSeed = 'ab'.repeat(32);
    const publicEntropy = sha256Hex('entropy');
    const deckFor = createDeckProvider({ serverSeed, tournamentId: 'TOUR', tableId: 'T1', publicEntropy });
    const h = new Harness({ initialButtonSeat: 2 });
    for (let i = 1; i <= 8; i += 1) h.rigged.set(i, deckFor(i));
    h.seat('a', 0);
    h.seat('b', 2);
    h.seat('c', 5);
    h.seat('d', 8);
    h.start();
    // play to showdown by calling/checking everything
    while (h.state.turn !== null) {
      const legal = h.legal();
      h.act(legal.canCheck ? { type: 'CHECK' } : { type: 'CALL' });
    }
    const hist = lastHandHistory(h.state);
    expect(hist).not.toBeNull();
    if (hist === null) return;
    expect(hist).toMatchObject({
      format: 'JPB-HAND-HISTORY',
      tournamentId: 'TOUR',
      tableId: 'T1',
      handId: 'T1:1',
      handNumber: 1,
      buttonSeat: 2,
      smallBlindSeat: 5,
      smallBlindPosition: 5,
      bigBlindSeat: 8,
      blinds: BLINDS,
      deckHash: sha256Hex(deckFor(1).join('')),
      dealingOrder: [5, 8, 0, 2],
      winType: 'SHOWDOWN',
      totalPot: 400,
    });
    expect(hist.board).toHaveLength(5);
    expect(hist.burns).toHaveLength(3);
    expect(hist.players.map((p) => p.displayName)).toEqual(['Name a', 'Name b', 'Name c', 'Name d']);
    expect(hist.actionLog.filter((e) => e.kind === 'FORCED_BET')).toHaveLength(2);
    expect(hist.players.reduce((s, p) => s + p.finalStack, 0)).toBe(40_000);
    // The accessor returns a copy.
    hist.board.length = 0;
    expect(lastHandHistory(h.state)?.board).toHaveLength(5);

    const record = handFairnessRecord(h.state, { publicEntropy, serverSeedHash: commitmentFor(serverSeed) });
    expect(record).not.toBeNull();
    if (record === null) return;
    expect(record.holeCards.map((x) => x.seat)).toEqual([5, 8, 0, 2]);
    const verdict = verifyHand(record, serverSeed);
    expect(verdict.status).toBe('VERIFIED');
    // Tampering is detected.
    const tampered = { ...record, board: [...record.board].reverse() };
    expect(verifyHand(tampered, serverSeed).status).toBe('FAILED');
  });

  it('fairness record and history are null before the first completed hand', () => {
    const h = threeHanded();
    expect(lastHandHistory(h.state)).toBeNull();
    expect(handFairnessRecord(h.state, { publicEntropy: 'x', serverSeedHash: 'y' })).toBeNull();
    h.start();
    expect(lastHandHistory(h.state)).toBeNull();
  });

  it('dealing uses exactly the provider deck for the hand number', () => {
    const h = threeHanded();
    const deck = riggedDeck({ seats: [0, 3, 6], buttonSeat: 0, maxSeats: 9, hole: { 3: ['2s', '3s'] } });
    h.rigged.set(1, deck);
    h.start();
    expect(h.state.hand?.players.find((p) => p.seat === 3)?.holeCards).toEqual(['2s', '3s']);
    expect(h.state.handMeta?.deckHash).toBe(sha256Hex(deck.join('')));
  });
});

describe('blinds and antes', () => {
  it('uses the current blind level including antes', () => {
    const h = new Harness({
      blinds: { level: 3, smallBlind: 100, bigBlind: 200, ante: 200, anteType: 'BB_ANTE' },
      initialButtonSeat: 0,
    });
    h.seat('a', 0);
    h.seat('b', 1);
    h.seat('c', 2);
    h.start();
    const posts = h.payloads('FORCED_BET_POSTED').map((e) => [e.seat, e.betType, e.amount]);
    expect(posts).toEqual([
      [2, 'ANTE', 200],
      [1, 'SMALL_BLIND', 100],
      [2, 'BIG_BLIND', 200],
    ]);
  });
});
