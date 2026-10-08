/**
 * Hand log: recent table events in plain words, built from deterministic
 * templates (same event → same sentence). Only server events are used.
 */
import type { CardCode, TableEvent, TableEventPayload } from '@jpb/shared-types';
import { cardShort, formatChips } from '@jpb/ui';

export type LogTone = 'neutral' | 'hero' | 'win' | 'street' | 'meta';

export interface LogLine {
  seq: number;
  text: string;
  tone: LogTone;
}

export interface LogHand {
  key: string;
  handNumber: number | null;
  lines: LogLine[];
}

export interface NameContext {
  heroSeat: number | null;
  /** Display name for a seat (falls back to "Seat N"). */
  nameOf: (seat: number) => string | null;
}

const cards = (cs: readonly CardCode[]) => cs.map(cardShort).join(' ');
const STREET_LABEL = { PREFLOP: 'Preflop', FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' } as const;
const BET_LABEL = { SMALL_BLIND: 'the small blind', BIG_BLIND: 'the big blind', ANTE: 'the ante' } as const;
const REMOVAL = {
  MOVED: 'moves to another table',
  ELIMINATED: 'is eliminated',
  DISQUALIFIED: 'leaves the tournament',
  ADMIN: 'leaves the table',
  TABLE_BROKEN: 'moves (table closing)',
  FINAL_TABLE: 'moves to the final table',
} as const;

interface Subject {
  name: string;
  you: boolean;
}

function subject(seat: number, ctx: NameContext): Subject {
  if (ctx.heroSeat === seat) return { name: 'You', you: true };
  return { name: ctx.nameOf(seat) ?? `Seat ${seat + 1}`, you: false };
}

/** "Kenji calls" / "You call". */
const verb = (s: Subject, third: string, base: string) => `${s.name} ${s.you ? base : third}`;

export function describeEvent(e: TableEventPayload, ctx: NameContext): { text: string; tone: LogTone } | null {
  switch (e.kind) {
    case 'HAND_STARTED':
      return {
        text: `New hand · blinds ${formatChips(e.smallBlind)} / ${formatChips(e.bigBlind)}${e.ante > 0 ? ` · ante ${formatChips(e.ante)}` : ''}`,
        tone: 'meta',
      };
    case 'FORCED_BET_POSTED': {
      const s = subject(e.seat, ctx);
      return { text: `${verb(s, 'posts', 'post')} ${BET_LABEL[e.betType]} ${formatChips(e.amount)}${e.allIn ? ' (all-in)' : ''}`, tone: s.you ? 'hero' : 'neutral' };
    }
    case 'HOLE_CARDS_DEALT':
      return ctx.heroSeat === e.seat ? { text: `You were dealt ${cards(e.cards)}`, tone: 'hero' } : null;
    case 'PLAYER_ACTED': {
      const s = subject(e.seat, ctx);
      const timeout = e.timeout ? ' — time ran out' : '';
      const text = (() => {
        switch (e.action) {
          case 'FOLD':
            return verb(s, 'folds', 'fold');
          case 'CHECK':
            return verb(s, 'checks', 'check');
          case 'CALL':
            return `${verb(s, 'calls', 'call')} ${formatChips(e.amount)}${e.allIn ? ' and is all-in' : ''}`;
          case 'BET':
            return `${verb(s, 'bets', 'bet')} ${formatChips(e.toAmount)}`;
          case 'RAISE':
            return `${verb(s, 'raises', 'raise')} to ${formatChips(e.toAmount)}`;
          case 'ALL_IN':
            return `${verb(s, 'goes', 'go')} all-in for ${formatChips(e.toAmount)}`;
          default:
            return null;
        }
      })();
      return text ? { text: text + timeout, tone: s.you ? 'hero' : 'neutral' } : null;
    }
    case 'STREET_STARTED':
      return { text: `${STREET_LABEL[e.street]}: ${cards(e.newCards)}`, tone: 'street' };
    case 'UNCALLED_BET_RETURNED': {
      const s = subject(e.seat, ctx);
      return { text: `${formatChips(e.amount)} uncalled returned to ${s.you ? 'you' : s.name}`, tone: 'meta' };
    }
    case 'SHOWDOWN': {
      const parts = e.reveals.map((r) => {
        const s = subject(r.seat, ctx);
        if (r.mucked || !r.cards) return verb(s, 'mucks', 'muck');
        return `${verb(s, 'shows', 'show')} ${cards(r.cards)}${r.hand ? ` — ${r.hand.description}` : ''}`;
      });
      return { text: parts.join(' · '), tone: 'neutral' };
    }
    case 'POT_AWARDED': {
      const potName = e.potType === 'MAIN' ? 'the pot' : `side pot ${e.potIndex}`;
      const winners = e.winners.map((w) => subject(w.seat, ctx));
      const hero = winners.some((w) => w.you);
      const how = e.winningHand ? ` with ${e.winningHand.description}` : ' uncontested';
      if (winners.length === 1) {
        const w = winners[0] as Subject;
        return { text: `${verb(w, 'wins', 'win')} ${potName} (${formatChips(e.amount)})${how}`, tone: hero ? 'win' : 'neutral' };
      }
      return { text: `${winners.map((w) => w.name).join(' and ')} split ${potName} (${formatChips(e.amount)})${how}`, tone: hero ? 'win' : 'neutral' };
    }
    case 'PLAYER_SEATED':
      return { text: ctx.heroSeat === e.seat ? `You sit down in seat ${e.seat + 1}` : `${e.displayName} sits down in seat ${e.seat + 1}`, tone: 'meta' };
    case 'PLAYER_REMOVED': {
      const s = subject(e.seat, ctx);
      return { text: `${s.name} ${REMOVAL[e.reason]}`, tone: 'meta' };
    }
    case 'BLINDS_SCHEDULED':
      return { text: `Blinds go up: ${formatChips(e.blinds.smallBlind)} / ${formatChips(e.blinds.bigBlind)} from the next hand`, tone: 'meta' };
    case 'TABLE_STATUS_CHANGED':
      if (e.frozen) return { text: 'Table paused by the tournament director', tone: 'meta' };
      if (e.status === 'HELD') return { text: `Table on hold${e.holds.length ? ` (${e.holds.map((h) => h.toLowerCase().replace(/_/g, ' ')).join(', ')})` : ''}`, tone: 'meta' };
      return null;
    case 'STACK_ADJUSTED': {
      const s = subject(e.seat, ctx);
      return { text: `${s.you ? 'Your' : `${s.name}'s`} stack was corrected to ${formatChips(e.after)} by a tournament official`, tone: 'meta' };
    }
    default:
      return null;
  }
}

/** Newest hand first; lines in the order they happened. */
export function buildHandLog(events: readonly TableEvent[], ctx: NameContext, maxHands = 12): LogHand[] {
  const hands: LogHand[] = [];
  let current: LogHand = { key: 'pre', handNumber: null, lines: [] };
  for (const e of events) {
    if (e.event.kind === 'HAND_STARTED') {
      if (current.lines.length > 0) hands.push(current);
      current = { key: e.event.handId, handNumber: e.event.handNumber, lines: [] };
    }
    const d = describeEvent(e.event, ctx);
    if (d) current.lines.push({ seq: e.seq, text: d.text, tone: d.tone });
  }
  if (current.lines.length > 0) hands.push(current);
  return hands.reverse().slice(0, maxHands);
}
