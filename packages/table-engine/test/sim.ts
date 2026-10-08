import { getLegalActions } from '@jpb/poker-engine';
import type { CurrentBlinds, PlayerActionIntent, TableEvent } from '@jpb/shared-types';
import { expect } from 'vitest';
import { adminView, chipsAtTable, handInProgress, playerView, spectatorView } from '../src';
import type { TableState } from '../src';
import { Harness, TIMING, ZERO_STATS } from './helpers';

/** Small deterministic PRNG (mulberry32). Tests never use Math.random(). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CARD_RE = /"([2-9TJQKA][cdhs])"/g;

function cardsIn(value: unknown): string[] {
  return [...JSON.stringify(value).matchAll(CARD_RE)].map((m) => m[1] as string);
}

/** Cards anyone may see now: the board of the displayed hand plus cards revealed at its showdown. */
function publicCards(s: TableState): Set<string> {
  const out = new Set<string>(s.hand?.board ?? []);
  for (const r of s.hand?.result?.reveals ?? []) if (r.cards) r.cards.forEach((c) => out.add(c));
  return out;
}

/** Views never leak another player's hole cards (players) or any unrevealed hole card (spectators). */
export function assertViewPrivacy(s: TableState, now: number): void {
  const pub = publicCards(s);
  for (const c of cardsIn(spectatorView(s, now))) expect(pub.has(c), `spectator view leaks ${c}`).toBe(true);
  // Without VIEW_HOLE_CARDS an admin sees public cards only (plus the boards of past hands in recentHands).
  const pastBoards = new Set<string>(s.recentHands.flatMap((x) => x.board));
  for (const c of cardsIn(adminView(s, now, { includeHoleCards: false }))) {
    expect(pub.has(c) || pastBoards.has(c), `admin view (no hole cards) leaks ${c}`).toBe(true);
  }
  // With it, the admin sees exactly the dealt hole cards of the displayed hand in addition.
  const withCards = adminView(s, now, { includeHoleCards: true });
  for (const p of s.hand?.players ?? []) expect(withCards.holeCards?.[p.seat]).toEqual(p.holeCards);
  for (const occ of s.seats) {
    if (occ === null) continue;
    const own = new Set<string>(s.hand?.players.find((p) => p.playerId === occ.playerId)?.holeCards ?? []);
    const view = playerView(s, occ.playerId, now);
    for (const c of cardsIn(view)) expect(pub.has(c) || own.has(c), `view of ${occ.playerId} leaks ${c}`).toBe(true);
  }
}

/** PUBLIC events never carry a hole card that was not revealed at showdown. */
export function assertEventPrivacy(events: readonly TableEvent[]): void {
  let allowed = new Set<string>();
  for (const e of events) {
    const ev = e.event;
    if (ev.kind === 'HAND_STARTED') allowed = new Set();
    if (ev.kind === 'HOLE_CARDS_DEALT') {
      expect(e.visibility).toBe('PRIVATE');
      expect(e.privateTo).toBe(ev.playerId);
      continue;
    }
    expect(e.visibility).toBe('PUBLIC');
    if (ev.kind === 'STREET_STARTED') ev.board.forEach((c) => allowed.add(c));
    if (ev.kind === 'SHOWDOWN') for (const r of ev.reveals) if (r.cards) r.cards.forEach((c) => allowed.add(c));
    for (const c of cardsIn(ev)) expect(allowed.has(c), `public event ${ev.kind} leaks ${c}`).toBe(true);
  }
}

export interface SimOptions {
  seed: number;
  hands: number;
  maxSeats?: number;
  maxSteps?: number;
  /** Check view privacy after every command (slower). */
  checkViews?: boolean;
}

export interface SimResult {
  h: Harness;
  steps: number;
}

/**
 * Plays `hands` hands at one table with seeded random legal (and illegal)
 * actions, timeouts, disconnects, stale/duplicate/late commands, seat
 * changes, blind changes, holds, hand-for-hand, freezes and stack adjustments.
 * Invariants are checked by the harness after every command; chip accounting
 * here.
 */
export function simulate(opts: SimOptions): SimResult {
  const rnd = prng(opts.seed);
  const int = (n: number): number => Math.floor(rnd() * n);
  const chance = (p: number): boolean => rnd() < p;
  const maxSeats = opts.maxSeats ?? 2 + int(9);
  const h = new Harness({ maxSeats, initialButtonSeat: chance(0.5) ? int(maxSeats) : null, seed: `sim-${opts.seed}` });
  let nextId = 0;
  let expectedChips = 0;
  let level = 1;
  let lastActionId: string | null = null;
  const oldTokens: string[] = [];

  const track = (): void => {
    for (const e of h.last?.events ?? []) {
      const ev = e.event;
      if (ev.kind === 'PLAYER_SEATED') expectedChips += ev.stack;
      if (ev.kind === 'PLAYER_REMOVED') expectedChips -= ev.stack;
      if (ev.kind === 'STACK_ADJUSTED') expectedChips += ev.after - ev.before;
    }
    for (const t of h.last?.timers ?? []) oldTokens.push(t.token);
    expect(chipsAtTable(h.state)).toBe(expectedChips);
    if (opts.checkViews) assertViewPrivacy(h.state, h.now);
  };
  const send = (...args: Parameters<Harness['send']>): void => {
    h.send(...args);
    track();
  };
  const seatSomeone = (): void => {
    const free = h.state.seats.flatMap((o, i) => (o === null ? [i] : []));
    if (free.length === 0) return;
    nextId += 1;
    send({
      type: 'SEAT_PLAYER',
      playerId: `p${nextId}`,
      displayName: `Player ${nextId}`,
      publicId: `JPN-${nextId}`,
      seat: free[int(free.length)] as number,
      stack: 100 + int(4_000),
      stats: { ...ZERO_STATS, handsPlayedTotal: int(50) },
      moveId: chance(0.5) ? `m${nextId}` : null,
      connected: chance(0.9),
    });
  };
  const randomPlayer = (): string | null => {
    const ids = h.state.seats.flatMap((o) => (o === null ? [] : [o.playerId]));
    return ids.length === 0 ? null : (ids[int(ids.length)] as string);
  };

  const initial = 2 + int(maxSeats - 1);
  for (let i = 0; i < initial; i += 1) seatSomeone();
  send({ type: 'START' });

  const maxSteps = opts.maxSteps ?? opts.hands * 60;
  let steps = 0;
  while (h.state.counters.handsPlayed < opts.hands && steps < maxSteps) {
    steps += 1;
    h.advance(int(4) === 0 ? int(20_000) : int(2_000));
    const s = h.state;
    const r = rnd();

    // Rare, any-time commands.
    if (r < 0.02) {
      const p = randomPlayer();
      if (p !== null) send({ type: 'PLAYER_CONNECTION', playerId: p, connected: chance(0.5) });
      continue;
    }
    if (r < 0.03) {
      send({ type: s.frozen === null ? 'FREEZE' : 'UNFREEZE' });
      continue;
    }
    if (r < 0.035 && oldTokens.length > 0) {
      send({
        type: 'TIMER_FIRED',
        kind: chance(0.5) ? 'ACTION_TIMEOUT' : 'NEXT_HAND',
        token: oldTokens[int(oldTokens.length)] as string,
      });
      continue;
    }
    if (r < 0.04) {
      level += 1;
      const bb = 100 * (1 + int(level));
      const blinds: CurrentBlinds = {
        level,
        smallBlind: Math.floor(bb / 2),
        bigBlind: bb,
        ante: chance(0.3) ? Math.floor(bb / 4) : 0,
        anteType: chance(0.5) ? 'BB_ANTE' : 'ALL_PLAYERS',
      };
      send({ type: 'SET_BLINDS', blinds });
      continue;
    }
    if (r < 0.045) {
      send({
        type: 'SET_TIMING',
        timing: { ...TIMING, actionTimerMs: 5_000 + int(20_000), awayAfterTimeouts: 1 + int(3) },
      });
      continue;
    }
    if (s.frozen !== null) {
      if (chance(0.3)) send({ type: 'UNFREEZE' });
      else if (handInProgress(s)) {
        // actions are rejected while frozen
        const turn = s.turn;
        if (turn !== null)
          send({
            type: 'PLAYER_ACTION',
            actionId: `x${steps}`,
            playerId: turn.playerId,
            intent: { type: 'FOLD' },
            tableStateVersion: turn.turnVersion,
          });
      }
      continue;
    }

    if (handInProgress(s)) {
      const turn = s.turn;
      if (turn === null) throw new Error('hand in progress without a turn');
      if (r < 0.06) {
        const p = randomPlayer();
        if (p !== null)
          send({
            type: 'REMOVE_PLAYER',
            playerId: p,
            reason: chance(0.5) ? 'MOVED' : 'DISQUALIFIED',
            moveId: chance(0.5) ? `mv${steps}` : null,
          });
        continue;
      }
      if (r < 0.07) {
        seatSomeone();
        continue;
      }
      if (r < 0.08) {
        send({ type: 'HOLD', reason: chance(0.5) ? 'PAUSE' : 'BREAK' });
        continue;
      }
      if (r < 0.1) {
        h.fireTurnTimer();
        track();
        continue;
      }
      if (r < 0.11) {
        send({ type: 'ADMIN_FORCE_TIMEOUT' });
        continue;
      }
      if (r < 0.115) {
        send({ type: 'ADMIN_ADD_TIME', ms: 1 + int(10_000) });
        continue;
      }
      if (r < 0.13 && lastActionId !== null) {
        send({
          type: 'PLAYER_ACTION',
          actionId: lastActionId,
          playerId: turn.playerId,
          intent: { type: 'FOLD' },
          tableStateVersion: turn.turnVersion,
        });
        continue;
      }
      if (r < 0.14) {
        send({
          type: 'PLAYER_ACTION',
          actionId: `st${steps}`,
          playerId: turn.playerId,
          intent: { type: 'CALL' },
          tableStateVersion: turn.turnVersion - 1 - int(3),
        });
        continue;
      }
      if (r < 0.15) {
        send(
          {
            type: 'PLAYER_ACTION',
            actionId: `late${steps}`,
            playerId: turn.playerId,
            intent: { type: 'CALL' },
            tableStateVersion: turn.turnVersion,
          },
          turn.deadline + turn.graceMs + 1 + int(5_000),
        );
        continue;
      }
      if (r < 0.16) {
        const garbage: PlayerActionIntent[] = [
          { type: 'RAISE', amount: -5 },
          { type: 'BET', amount: 1.5 },
          { type: 'NOPE' as never },
          { type: 'RAISE', amount: 999_999_999 },
        ];
        send({
          type: 'PLAYER_ACTION',
          actionId: `g${steps}`,
          playerId: turn.playerId,
          intent: garbage[int(garbage.length)] as PlayerActionIntent,
          tableStateVersion: turn.turnVersion,
        });
        continue;
      }
      // A random legal action, within the deadline.
      const hand = s.hand;
      const legal = hand === null ? null : getLegalActions(hand);
      if (legal === null) throw new Error('no legal actions for the acting seat');
      const options: PlayerActionIntent[] = [{ type: 'FOLD' }];
      if (legal.canCheck) options.push({ type: 'CHECK' }, { type: 'CHECK' }, { type: 'CHECK' });
      if (legal.canCall) options.push({ type: 'CALL' }, { type: 'CALL' }, { type: 'CALL' });
      if (legal.canBet || legal.canRaise) {
        const span = legal.maxTo - legal.minTo;
        const amount = legal.minTo + (chance(0.6) ? 0 : int(span + 1));
        options.push({ type: legal.canBet ? 'BET' : 'RAISE', amount });
      }
      if (legal.canAllIn) options.push({ type: 'ALL_IN' });
      const intent = options[int(options.length)] as PlayerActionIntent;
      const actionId = `act${steps}`;
      const at = Math.min(h.now, turn.deadline + turn.graceMs);
      send(
        { type: 'PLAYER_ACTION', actionId, playerId: turn.playerId, intent, tableStateVersion: turn.turnVersion },
        Math.max(at, s.clock),
      );
      lastActionId = actionId;
      continue;
    }

    // Between hands / held / waiting.
    if (s.holds.length > 0 && chance(0.5)) {
      send({ type: 'RELEASE', reason: s.holds[int(s.holds.length)] as never });
      continue;
    }
    if (r < 0.1) {
      send({ type: 'SET_HAND_FOR_HAND', enabled: !s.handForHand });
      continue;
    }
    if (r < 0.15) {
      const p = randomPlayer();
      if (p !== null) send({ type: 'ADMIN_ADJUST_STACK', playerId: p, newStack: 1 + int(5_000) });
      continue;
    }
    if (r < 0.2) {
      const p = randomPlayer();
      if (p !== null && s.seats.filter((o) => o !== null).length > 2)
        send({ type: 'REMOVE_PLAYER', playerId: p, reason: 'MOVED', moveId: `mv${steps}` });
      continue;
    }
    const seated = s.seats.filter((o) => o !== null).length;
    if (r < 0.3 || seated < 2) {
      seatSomeone();
      continue;
    }
    if (s.status === 'BETWEEN_HANDS') {
      h.fireNextHand();
      track();
      continue;
    }
    if (s.status === 'HELD') {
      send({ type: 'RELEASE', reason: s.holds[0] as never });
    }
  }
  return { h, steps };
}
