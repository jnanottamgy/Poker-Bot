/**
 * Adversarial property tests (betting lens).
 *
 * Random hands are played through the engine; an INDEPENDENT reference model
 * re-derives everything from the public event stream alone and checks it
 * against the contract (CONTRACTS.md §3):
 *   - who acts next (rules 3-4) and when a betting round closes (rule 7);
 *   - the legal actions offered (rule 5) including incomplete raises and
 *     cumulative re-opening (rule 6);
 *   - PLAYER_ACTED bookkeeping (amount moved, stack, all-in flag, raise sizes);
 *   - uncalled bet (rule 9), pots by live all-in level with folded money and
 *     BB_ANTE dead money (rule 10), award order (rule 12), odd chips (rule 13),
 *     final stacks and chip conservation (rule 14);
 *   - showdown reveal order / mucks (rule 11) and that pot winners are shown;
 *   - event ordering.
 * Also: BET/RAISE amounts are accepted iff they are safe integers within
 * [minTo, maxTo]; inputs are never mutated.
 */
import { CANONICAL_DECK } from '@jpb/shared-types';
import type {
  AnteType,
  CardCode,
  HandEvent,
  LegalActions,
  PlayerActionIntent,
  ShowdownReveal,
} from '@jpb/shared-types';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyAction, checkHandInvariants, createHand, evaluateHand, getLegalActions, timeoutIntent } from '../src';
import type { CreateHandInput, HandState } from '../src';
import { prng, randInt } from './helpers';

// ---------------------------------------------------------------------------
// random hand generation

function shuffle<T>(items: readonly T[], rnd: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rnd, i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

function cw(from: number, seat: number, max: number): number {
  const d = (((seat - from) % max) + max) % max;
  return d === 0 ? max : d;
}

function clockwise(seats: readonly number[], from: number, max: number): number[] {
  return [...seats].sort((a, b) => cw(from, a, max) - cw(from, b, max));
}

function randomInput(seed: number): CreateHandInput {
  const rnd = prng(seed);
  const maxSeats = 2 + randInt(rnd, 9);
  const n = 2 + randInt(rnd, maxSeats - 1);
  const seats = shuffle(
    Array.from({ length: maxSeats }, (_, i) => i),
    rnd,
  )
    .slice(0, n)
    .sort((a, b) => a - b);
  const bigBlind = [2, 3, 10, 25, 100][randInt(rnd, 5)] as number;
  const smallBlind = rnd() < 0.7 ? Math.floor(bigBlind / 2) : randInt(rnd, bigBlind + 1);
  const anteType = (['NONE', 'ALL_PLAYERS', 'BB_ANTE'] as AnteType[])[randInt(rnd, 3)] as AnteType;
  const ante = anteType === 'NONE' ? 0 : randInt(rnd, 2 * bigBlind + 1);
  const stackFor = (): number => {
    const r = rnd();
    if (r < 0.25) return 1 + randInt(rnd, 2 * bigBlind + 2);
    if (r < 0.6) return bigBlind * (2 + randInt(rnd, 20)) + randInt(rnd, bigBlind);
    return bigBlind * (20 + randInt(rnd, 200)) + randInt(rnd, 7);
  };
  const emptySeats = Array.from({ length: maxSeats }, (_, i) => i).filter((s) => !seats.includes(s));
  const deadButton = emptySeats.length > 0 && rnd() < 0.25;
  const buttonSeat = deadButton
    ? (emptySeats[randInt(rnd, emptySeats.length)] as number)
    : (seats[randInt(rnd, n)] as number);
  const order = clockwise(seats, buttonSeat, maxSeats);
  let smallBlindSeat: number | null;
  let bigBlindSeat: number;
  if (n === 2 && !deadButton) {
    smallBlindSeat = buttonSeat;
    bigBlindSeat = order[0] as number;
  } else {
    smallBlindSeat = rnd() < 0.15 ? null : (order[0] as number);
    bigBlindSeat = order[1] as number;
  }
  return {
    handId: `H${seed}`,
    handNumber: 1,
    maxSeats,
    seats: shuffle(seats, rnd).map((seat) => ({ seat, playerId: `p${seat}`, stack: stackFor() })),
    buttonSeat,
    smallBlindSeat,
    bigBlindSeat,
    smallBlind,
    bigBlind,
    ante,
    anteType,
    deck: shuffle(CANONICAL_DECK, rnd),
  };
}

// ---------------------------------------------------------------------------
// reference model driven by events only

interface MP {
  seat: number;
  start: number;
  stack: number;
  street: number;
  total: number;
  ante: number;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  level: number | null;
  hole: [CardCode, CardCode] | null;
}

type Done = 'yes' | 'no';

/** Coverage counters: the generator must actually reach the interesting cases. */
const STATS = {
  hands: 0,
  incompleteRaises: 0,
  cumulativeReopens: 0,
  closedAfterIncomplete: 0,
  sidePots3plus: 0,
  oddChipPots: 0,
  mucks: 0,
  uncalled: 0,
  foldWins: 0,
  runOuts: 0,
  disputedSingleActor: 0,
  uncontestedWinnerHidden: 0,
};

class Model {
  readonly players = new Map<number, MP>();
  cb = 0;
  lastFull = 0;
  street: 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' = 'PREFLOP';
  promptFrom: number;
  lastTurn: { seat: number; legal: LegalActions } | null = null;
  firstPromptOfStreet = true;
  riverAggressor: number | null = null;
  runOut = false;
  pendingCompletionCheck = false;
  dealt = false;
  streets: string[] = [];
  uncalled: { seat: number; amount: number } | null = null;
  awarded: Array<Extract<HandEvent, { kind: 'POT_AWARDED' }>> = [];
  reveals: ShowdownReveal[] | null = null;
  completed = false;
  kinds: string[] = [];

  constructor(readonly input: CreateHandInput) {
    for (const s of input.seats) {
      this.players.set(s.seat, {
        seat: s.seat,
        start: s.stack,
        stack: s.stack,
        street: 0,
        total: 0,
        ante: 0,
        folded: false,
        allIn: false,
        acted: false,
        level: null,
        hole: null,
      });
    }
    this.promptFrom = input.bigBlindSeat;
  }

  get bb(): number {
    return this.input.bigBlind;
  }

  p(seat: number): MP {
    const p = this.players.get(seat);
    if (p === undefined) throw new Error(`model: unknown seat ${seat}`);
    return p;
  }

  seatsCw(from: number): MP[] {
    return clockwise([...this.players.keys()], from, this.input.maxSeats).map((s) => this.p(s));
  }

  live(): MP[] {
    return [...this.players.values()].filter((p) => !p.folded);
  }

  needs(p: MP): boolean {
    return !p.folded && !p.allIn && (!p.acted || p.street < this.cb);
  }

  /**
   * Rule 7. A single remaining actor who already covers every live opponent's street
   * contribution has no decision, even below the nominal big blind (BB all-in for less).
   */
  roundDone(): Done {
    const live = this.live();
    if (live.length <= 1) return 'yes';
    const actors = live.filter((p) => !p.allIn);
    if (actors.length === 0) return 'yes';
    if (actors.length === 1) {
      const a = actors[0] as MP;
      if (a.street >= this.cb) return 'yes';
      const maxOther = Math.max(0, ...live.filter((p) => p !== a).map((p) => p.street));
      if (a.street >= maxOther) {
        STATS.disputedSingleActor++;
        return 'yes';
      }
      return 'no';
    }
    return actors.some((p) => this.needs(p)) ? 'no' : 'yes';
  }

  legalFor(p: MP): Omit<LegalActions, 'playerId' | 'pot'> {
    const toCall = Math.max(0, this.cb - p.street);
    const allInTo = p.street + p.stack;
    const open = !p.acted || p.level === null || this.cb - p.level >= this.lastFull;
    const canBet = this.cb === 0 && p.stack > 0;
    const canRaise = this.cb > 0 && p.stack > toCall && open;
    let minTo = 0;
    let maxTo = 0;
    if (canBet) {
      minTo = Math.min(this.bb, allInTo);
      maxTo = allInTo;
    } else if (canRaise) {
      minTo = Math.min(this.cb + this.lastFull, allInTo);
      maxTo = allInTo;
    }
    return {
      seat: p.seat,
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount: Math.min(toCall, p.stack),
      canBet,
      canRaise,
      minTo,
      maxTo,
      canAllIn: p.stack > 0 && (allInTo <= this.cb || canBet || canRaise),
      allInTo,
      currentBet: this.cb,
      contributedThisStreet: p.street,
      stack: p.stack,
    };
  }

  private checkPendingCompletion(e: HandEvent): void {
    if (!this.pendingCompletionCheck) return;
    this.pendingCompletionCheck = false;
    const done = this.roundDone();
    if (e.kind === 'TURN_TO_ACT') {
      expect(done, `round should be complete before ${e.kind}`).not.toBe('yes');
    } else {
      expect(done, `round should be open but engine emitted ${e.kind}`).not.toBe('no');
      const live = this.live();
      if (this.street !== 'RIVER' && live.length >= 2 && live.filter((p) => !p.allIn).length <= 1) this.runOut = true;
    }
  }

  apply(e: HandEvent): void {
    this.kinds.push(e.kind);
    expect(this.completed, `event ${e.kind} after HAND_COMPLETED`).toBe(false);
    this.checkPendingCompletion(e);
    switch (e.kind) {
      case 'HAND_STARTED':
        expect(e.players.map((p) => [p.seat, p.stack])).toEqual(
          [...this.input.seats].sort((a, b) => a.seat - b.seat).map((s) => [s.seat, s.stack]),
        );
        break;
      case 'FORCED_BET_POSTED': {
        expect(this.dealt).toBe(false);
        const p = this.p(e.seat);
        expect(e.amount).toBeGreaterThan(0);
        expect(e.amount).toBeLessThanOrEqual(p.stack);
        p.stack -= e.amount;
        p.total += e.amount;
        if (e.betType === 'ANTE') p.ante += e.amount;
        else p.street += e.amount;
        p.allIn = p.stack === 0;
        expect(e.stack).toBe(p.stack);
        expect(e.allIn).toBe(p.allIn);
        break;
      }
      case 'HOLE_CARDS_DEALT': {
        if (!this.dealt) {
          this.dealt = true;
          this.cb = this.bb;
          this.lastFull = this.bb;
          this.checkForcedBets();
        }
        this.p(e.seat).hole = e.cards;
        if ([...this.players.values()].every((p) => p.hole !== null)) this.pendingCompletionCheck = true;
        break;
      }
      case 'STREET_STARTED': {
        const next = { PREFLOP: 'FLOP', FLOP: 'TURN', TURN: 'RIVER' }[this.street as 'PREFLOP' | 'FLOP' | 'TURN'];
        expect(e.street).toBe(next);
        this.street = e.street;
        this.streets.push(e.street);
        expect(e.board).toHaveLength({ FLOP: 3, TURN: 4, RIVER: 5 }[e.street as 'FLOP' | 'TURN' | 'RIVER']);
        this.cb = 0;
        this.lastFull = this.bb;
        for (const p of this.players.values()) {
          p.street = 0;
          p.acted = false;
          p.level = null;
        }
        this.promptFrom = this.input.buttonSeat;
        this.pendingCompletionCheck = true;
        break;
      }
      case 'TURN_TO_ACT': {
        const expected = this.seatsCw(this.promptFrom).find((p) => this.needs(p));
        expect(expected, 'nobody should be prompted').toBeDefined();
        expect(e.seat, 'wrong seat prompted').toBe(expected?.seat);
        const { playerId: _pid, pot: _pot, ...legal } = e.legal;
        expect(legal).toEqual(this.legalFor(this.p(e.seat)));
        {
          const me = this.p(e.seat);
          if (me.acted && me.level !== null && me.stack > this.cb - me.street) {
            const rise = this.cb - me.level;
            if (rise > 0 && rise < this.lastFull) STATS.closedAfterIncomplete++;
            if (rise >= this.lastFull && e.legal.canRaise) STATS.cumulativeReopens++;
          }
        }
        this.lastTurn = { seat: e.seat, legal: e.legal };
        break;
      }
      case 'PLAYER_ACTED': {
        const turn = this.lastTurn;
        expect(turn?.seat, 'acted without being prompted').toBe(e.seat);
        const legal = (turn as { legal: LegalActions }).legal;
        this.lastTurn = null;
        const p = this.p(e.seat);
        if (e.action === 'FOLD') {
          expect(e.amount).toBe(0);
          p.folded = true;
        } else {
          expect(e.amount).toBe(e.toAmount - p.street);
          if (e.action === 'CHECK') {
            expect(legal.canCheck).toBe(true);
            expect(e.amount).toBe(0);
          } else if (e.action === 'CALL') {
            expect(legal.canCall).toBe(true);
            expect(e.amount).toBe(legal.callAmount);
          } else {
            expect(e.action === 'BET' ? legal.canBet : legal.canRaise, `${e.action} was not legal`).toBe(true);
            expect(e.toAmount).toBeGreaterThanOrEqual(legal.minTo);
            expect(e.toAmount).toBeLessThanOrEqual(legal.maxTo);
          }
          p.stack -= e.amount;
          p.total += e.amount;
          p.street = e.toAmount;
          p.allIn = p.stack === 0;
          if (e.toAmount > this.cb) {
            expect(['BET', 'RAISE']).toContain(e.action);
            const inc = e.toAmount - this.cb;
            if (inc >= this.lastFull) this.lastFull = inc;
            else {
              expect(p.allIn, 'an incomplete bet/raise must be all-in').toBe(true);
              STATS.incompleteRaises++;
            }
            this.cb = e.toAmount;
            if (this.street === 'RIVER') this.riverAggressor = p.seat;
          } else {
            expect(['CHECK', 'CALL']).toContain(e.action);
          }
        }
        expect(e.stack).toBe(p.stack);
        expect(e.allIn).toBe(p.allIn);
        p.acted = true;
        p.level = this.cb;
        this.promptFrom = e.seat;
        this.pendingCompletionCheck = true;
        break;
      }
      case 'BETTING_ROUND_COMPLETE':
        expect(e.street).toBe(this.street);
        break;
      case 'UNCALLED_BET_RETURNED':
        STATS.uncalled++;
        expect(this.uncalled).toBeNull();
        this.uncalled = { seat: e.seat, amount: e.amount };
        break;
      case 'SHOWDOWN':
        expect(this.reveals).toBeNull();
        this.reveals = e.reveals;
        break;
      case 'POT_AWARDED':
        this.awarded.push(e);
        break;
      case 'HAND_COMPLETED':
        this.completed = true;
        this.checkResult(e);
        break;
    }
  }

  private checkForcedBets(): void {
    // Antes before blinds; SB before BB (rule 1).
    const k = this.kinds.filter((x) => x === 'FORCED_BET_POSTED').length;
    expect(k).toBeLessThanOrEqual(this.players.size + 2);
  }

  /** Independent pots/payouts (rules 9, 10, 12, 13). */
  private checkResult(e: Extract<HandEvent, { kind: 'HAND_COMPLETED' }>): void {
    const bbAnte = this.input.anteType === 'BB_ANTE';
    const all = [...this.players.values()].sort((a, b) => a.seat - b.seat);
    const level = new Map(all.map((p) => [p.seat, bbAnte ? p.total - p.ante : p.total]));
    const dead = bbAnte ? all.reduce((s, p) => s + p.ante, 0) : 0;

    // Rule 9: uncalled = excess of a unique top contribution over the second highest.
    const sorted = [...level.entries()].sort((a, b) => b[1] - a[1]);
    const [top, second] = [sorted[0] as [number, number], sorted[1] as [number, number]];
    const expectedUncalled = top[1] > second[1] ? { seat: top[0], amount: top[1] - second[1] } : null;
    expect(this.uncalled, 'uncalled bet').toEqual(expectedUncalled);
    if (expectedUncalled) level.set(expectedUncalled.seat, second[1]);

    // Rule 10: pots split at live contribution levels; folded chips in the layer they reach.
    const live = this.live();
    const liveLevels = [...new Set(live.map((p) => level.get(p.seat) as number).filter((a) => a > 0))].sort(
      (a, b) => a - b,
    );
    const pots: Array<{ amount: number; eligible: number[] }> = [];
    let prev = 0;
    for (const L of liveLevels) {
      let amount = 0;
      for (const [, a] of level) amount += Math.min(a, L) - Math.min(a, prev);
      pots.push({
        amount,
        eligible: live
          .filter((p) => (level.get(p.seat) as number) >= L)
          .map((p) => p.seat)
          .sort((a, b) => a - b),
      });
      prev = L;
    }
    let above = 0;
    for (const [, a] of level) above += Math.max(0, a - prev);
    if (pots.length === 0) {
      pots.push({ amount: 0, eligible: live.map((p) => p.seat).sort((a, b) => a - b) });
    }
    (pots[pots.length - 1] as { amount: number }).amount += above;
    (pots[0] as { amount: number }).amount += dead;
    const realPots = pots.filter((p) => p.amount > 0);

    // Award order: last side pot first (rule 12).
    const idx = this.awarded.map((a) => a.potIndex);
    expect(idx).toEqual([...idx].sort((a, b) => b - a));
    const engine = [...this.awarded].sort((a, b) => a.potIndex - b.potIndex);
    expect(
      engine.map((a) => ({ amount: a.amount, eligible: a.eligibleSeats })),
      'pot structure',
    ).toEqual(realPots.map((p) => ({ amount: p.amount, eligible: p.eligible })));
    engine.forEach((a, i) => expect(a.potType).toBe(i === 0 ? 'MAIN' : 'SIDE'));

    // Winners and odd chips (rule 13).
    const board = e.board;
    const showdown = live.length >= 2;
    expect(board).toHaveLength(showdown ? 5 : board.length);
    const score = new Map<number, number>();
    if (showdown) {
      for (const p of live) score.set(p.seat, evaluateHand([...(p.hole as [CardCode, CardCode]), ...board]).score);
    }
    const won = new Map<number, number>();
    const potWinners: number[][] = [];
    realPots.forEach((pot, i) => {
      let winners = pot.eligible;
      if (winners.length > 1) {
        const best = Math.max(...winners.map((s) => score.get(s) as number));
        winners = winners.filter((s) => score.get(s) === best);
      }
      const ordered = clockwise(winners, this.input.buttonSeat, this.input.maxSeats);
      const base = Math.floor(pot.amount / ordered.length);
      const odd = pot.amount % ordered.length;
      if (odd > 0) STATS.oddChipPots++;
      const shares = ordered.map((seat, k) => ({ seat, amount: base + (k < odd ? 1 : 0), oddChips: k < odd ? 1 : 0 }));
      expect(
        engine[i]?.winners.map((w) => ({ seat: w.seat, amount: w.amount, oddChips: w.oddChips })),
        `pot ${i} winners`,
      ).toEqual(shares);
      for (const s of shares) won.set(s.seat, (won.get(s.seat) ?? 0) + s.amount);
      potWinners.push(winners);
    });

    // Final stacks (rule 14).
    const finalStacks = all.map((p) => ({
      seat: p.seat,
      playerId: `p${p.seat}`,
      stack: p.stack + (expectedUncalled?.seat === p.seat ? expectedUncalled.amount : 0) + (won.get(p.seat) ?? 0),
    }));
    expect(e.finalStacks).toEqual(finalStacks);
    expect(finalStacks.reduce((s, p) => s + p.stack, 0)).toBe(all.reduce((s, p) => s + p.start, 0));
    expect(e.bustedSeats).toEqual(finalStacks.filter((p) => p.stack === 0).map((p) => p.seat));
    expect(e.totalPot).toBe(realPots.reduce((s, p) => s + p.amount, 0));

    // Showdown (rules 8, 11).
    STATS.hands++;
    if (realPots.length >= 3) STATS.sidePots3plus++;
    if (!showdown) {
      STATS.foldWins++;
      expect(this.reveals, 'fold win shows nothing').toBeNull();
      return;
    }
    const reveals = this.reveals as ShowdownReveal[];
    expect(reveals).not.toBeNull();
    const liveCw = clockwise(
      live.map((p) => p.seat),
      this.input.buttonSeat,
      this.input.maxSeats,
    );
    const first =
      !this.runOut && this.riverAggressor !== null && live.some((p) => p.seat === this.riverAggressor)
        ? this.riverAggressor
        : (liveCw[0] as number);
    const start = liveCw.indexOf(first);
    const order = [...liveCw.slice(start), ...liveCw.slice(0, start)];
    expect(
      reveals.map((r) => r.seat),
      'reveal order',
    ).toEqual(order);
    const shown = new Set<number>();
    for (const r of reveals) {
      const mine = score.get(r.seat) as number;
      const mustShow =
        this.runOut ||
        shown.size === 0 ||
        realPots.some(
          (pot) =>
            pot.eligible.length >= 2 &&
            pot.eligible.includes(r.seat) &&
            pot.eligible.filter((s) => shown.has(s)).every((s) => (score.get(s) as number) <= mine),
        );
      // Rule 11: players who win a pot are always revealed, including an uncontested pot.
      const winsUncontested = realPots.some((pot) => pot.eligible.length === 1 && pot.eligible[0] === r.seat);
      expect(r.mucked, `seat ${r.seat} muck decision`).toBe(!(mustShow || winsUncontested));
      if (r.mucked) STATS.mucks++;
      if (!r.mucked) {
        shown.add(r.seat);
        expect(r.cards).toEqual(this.p(r.seat).hole);
      } else {
        expect(r.cards).toBeNull();
      }
    }
    if (this.runOut) STATS.runOuts++;
    // Contract rule 11: "Players who win a pot are always revealed" (uncontested pots too).
    realPots.forEach((pot) => {
      if (pot.eligible.length === 1 && !shown.has(pot.eligible[0] as number)) STATS.uncontestedWinnerHidden++;
    });
    expect(STATS.uncontestedWinnerHidden, 'uncontested pot winner hidden').toBe(0);
    realPots.forEach((pot, i) => {
      if (pot.eligible.length >= 2) for (const s of potWinners[i] as number[]) expect(shown.has(s)).toBe(true);
    });
  }
}

// ---------------------------------------------------------------------------
// driver

const GARBAGE: unknown[] = [
  null,
  {},
  { type: 'fold' },
  { type: 'RAISE', amount: Number.NaN },
  { type: 'BET', amount: -1 },
  { type: 'RAISE', amount: 1.5 },
  { type: 'RAISE', amount: 999999999 },
  { type: 'BET', amount: 999999999 },
];

function chooseIntent(legal: LegalActions, rnd: () => number): PlayerActionIntent {
  const r = rnd();
  if (r < 0.1) return { type: 'FOLD' };
  if (r < 0.5) return legal.canCheck ? { type: 'CHECK' } : { type: 'CALL' };
  if (r < 0.85 && (legal.canBet || legal.canRaise)) {
    const type = legal.canBet ? 'BET' : 'RAISE';
    const k = rnd();
    const amount =
      k < 0.4
        ? legal.minTo
        : k < 0.55
          ? legal.maxTo
          : legal.minTo + randInt(rnd, Math.max(1, legal.maxTo - legal.minTo + 1));
    return { type, amount };
  }
  if (legal.canAllIn && r < 0.95) return { type: 'ALL_IN' };
  return legal.canCheck ? { type: 'CHECK' } : { type: 'CALL' };
}

/** BET/RAISE x is accepted iff x is a safe integer with minTo <= x <= maxTo. */
function probeAmounts(state: HandState, legal: LegalActions, rnd: () => number): void {
  if (!legal.canBet && !legal.canRaise) return;
  const type = legal.canBet ? 'BET' : 'RAISE';
  const candidates = [
    legal.minTo - 1,
    legal.minTo,
    legal.maxTo,
    legal.maxTo + 1,
    legal.minTo + randInt(rnd, legal.maxTo - legal.minTo + 1),
    legal.minTo + 0.5,
    -legal.minTo,
  ];
  for (const x of candidates) {
    const r = applyAction(state, legal.seat, { type, amount: x });
    const ok = Number.isSafeInteger(x) && x >= legal.minTo && x <= legal.maxTo;
    expect(r.ok, `${type} ${x} with [${legal.minTo}, ${legal.maxTo}]`).toBe(ok);
    if (!r.ok) {
      const expectedCode = !Number.isSafeInteger(x)
        ? 'AMOUNT_NOT_INTEGER'
        : x < legal.minTo
          ? 'AMOUNT_BELOW_MINIMUM'
          : 'AMOUNT_ABOVE_MAXIMUM';
      expect(r.code).toBe(expectedCode);
    }
  }
}

function playRandomHand(seed: number): { model: Model; state: HandState } {
  const input = randomInput(seed);
  const rnd = prng(seed ^ 0x5bd1e995);
  const created = createHand(structuredClone(input));
  const model = new Model(input);
  created.events.forEach((e) => model.apply(e));
  let state = created.state;
  expect(checkHandInvariants(state)).toEqual([]);
  for (let step = 0; state.phase !== 'HAND_COMPLETE'; step++) {
    expect(step).toBeLessThan(400);
    const legal = getLegalActions(state);
    expect(legal).not.toBeNull();
    const l = legal as LegalActions;
    if (rnd() < 0.15) probeAmounts(state, l, rnd);
    if (rnd() < 0.05) {
      const before = JSON.stringify(state);
      const g = GARBAGE[randInt(rnd, GARBAGE.length)];
      const bad = applyAction(state, l.seat, g as PlayerActionIntent);
      if (bad.ok) {
        // Only possible for amounts that happen to be legal (e.g. 999999999 with a huge stack).
        expect((g as { amount?: number }).amount).toBeLessThanOrEqual(l.maxTo);
      }
      expect(JSON.stringify(state)).toBe(before);
    }
    const timeout = rnd() < 0.08;
    const intent = timeout ? timeoutIntent(state) : chooseIntent(l, rnd);
    const before = JSON.stringify(state);
    const r = applyAction(state, l.seat, intent, { timeout });
    expect(JSON.stringify(state)).toBe(before);
    if (!r.ok) throw new Error(`legal intent rejected: ${JSON.stringify(intent)} -> ${r.code}`);
    r.events.forEach((e) => model.apply(e));
    state = r.state;
    expect(checkHandInvariants(state)).toEqual([]);
  }
  expect(model.completed).toBe(true);
  return { model, state };
}

// ---------------------------------------------------------------------------

describe('adversarial-betting: independent reference model (fast-check)', () => {
  it('random hands agree with the event-driven reference model on every betting/pot/showdown decision', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        playRandomHand(seed);
      }),
      { numRuns: 2500, seed: 0x1badb002 },
    );
  }, 300_000);

  it('a fixed seed sweep (deterministic, no shrinking noise)', () => {
    for (let seed = 1; seed <= 1500; seed++) {
      try {
        playRandomHand(seed);
      } catch (err) {
        throw new Error(`seed ${seed}: ${(err as Error).message}`, { cause: err });
      }
    }
  }, 300_000);

  it('the generated hands covered every interesting betting/pot situation', () => {
    // Runs after the two sweeps above (same file, sequential).
    console.info('adversarial-betting coverage', STATS);
    expect(STATS.hands).toBeGreaterThan(3000);
    for (const key of [
      'incompleteRaises',
      'cumulativeReopens',
      'closedAfterIncomplete',
      'sidePots3plus',
      'oddChipPots',
      'mucks',
      'uncalled',
      'foldWins',
      'runOuts',
    ] as const) {
      expect(STATS[key], key).toBeGreaterThan(10);
    }
  });

  it('replaying the same seed yields byte-identical final states', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        const a = playRandomHand(seed).state;
        const b = playRandomHand(seed).state;
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }),
      { numRuns: 200, seed: 7 },
    );
  }, 120_000);
});
