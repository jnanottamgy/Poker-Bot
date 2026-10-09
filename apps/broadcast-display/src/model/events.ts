import type { BlindLevel, TournamentEventEnvelope } from '@jpb/shared-types';
import { formatChips, formatCount, formatOrdinal } from '@jpb/ui';
import type { Splash, TickerItem, Tone } from './types';

/**
 * Deterministic broadcast copy: every line is a fixed template filled from
 * one server event (same event -> same text). No AI, no randomness.
 */

/**
 * Eliminations get a full-screen splash only deep in the field (they are
 * always in the ticker): at or below this finishing position, or inside the
 * paid places when more places are paid.
 */
export const ELIMINATION_SPLASH_MAX_POSITION = 27;

export function blindsText(level: Pick<BlindLevel, 'smallBlind' | 'bigBlind' | 'ante'>): string {
  const base = `${formatChips(level.smallBlind)} / ${formatChips(level.bigBlind)}`;
  return level.ante > 0 ? `${base} · ante ${formatChips(level.ante)}` : base;
}

export function finishText(name: string, position: number, tiedCount: number): string {
  const tie = tiedCount > 1 ? ` (tied)` : '';
  return `${name} finishes in ${formatOrdinal(position)} place${tie}`;
}

function item(env: TournamentEventEnvelope, tone: Tone, text: string): TickerItem {
  return { id: `t${env.seq}`, at: env.at, tone, text };
}

/** One ticker line per broadcast-worthy tournament event (null = not shown). */
export function tickerItemFor(env: TournamentEventEnvelope): TickerItem | null {
  const e = env.event;
  switch (e.kind) {
    case 'PLAYER_ELIMINATED':
      return item(env, 'elim', `${finishText(e.displayName, e.record.finishPosition, e.record.tiedCount)} · ${formatCount(e.playersRemaining)} remain`);
    case 'BLIND_LEVEL_CHANGED':
      return item(env, 'info', `Level ${e.to.level} · blinds ${blindsText(e.to)}`);
    case 'BREAK_STARTED':
      return item(env, 'warning', e.message ? `Break · ${e.message}` : 'Break time');
    case 'BREAK_ENDED':
      return item(env, 'info', 'Break over · cards are in the air');
    case 'TOURNAMENT_PAUSED':
      return item(env, 'warning', e.mode === 'EMERGENCY_FREEZE' ? 'Play is frozen by the tournament director' : 'Tournament paused after the current hands');
    case 'TOURNAMENT_RESUMED':
      return item(env, 'info', 'Play resumes');
    case 'TABLE_BROKEN':
      return item(env, 'info', `Table ${e.tableNumber} breaks · ${formatCount(e.playersMoved)} ${e.playersMoved === 1 ? 'player' : 'players'} moved`);
    case 'FINAL_TABLE_FORMED':
      return item(env, 'gold', `Final table formed · ${formatCount(e.players.length)} players`);
    case 'HAND_FOR_HAND':
      return item(env, 'warning', e.enabled ? 'Hand-for-hand play is on' : 'Hand-for-hand play is over');
    case 'MILESTONE':
      return item(env, 'gold', sentenceCase(e.text));
    case 'ANNOUNCEMENT':
      return item(env, 'neutral', e.text);
    case 'TOURNAMENT_COMPLETED':
      return item(env, 'gold', `${e.winnerName} is the champion`);
    default:
      return null;
  }
}

/** Full-screen milestone splash for an event (null = ticker only). */
export function splashFor(env: TournamentEventEnvelope, at: number, paidPlaces: number): Splash | null {
  const e = env.event;
  const id = `s${env.seq}`;
  switch (e.kind) {
    case 'PLAYER_ELIMINATED': {
      const pos = e.record.finishPosition;
      if (pos > Math.max(ELIMINATION_SPLASH_MAX_POSITION, paidPlaces)) return null;
      return {
        id,
        at,
        kind: 'ELIMINATION',
        tone: 'elim',
        eyebrow: 'Eliminated',
        title: e.displayName,
        subtitle: `finishes in ${formatOrdinal(pos)} place${e.record.tiedCount > 1 ? ' (tied)' : ''} · ${formatCount(e.playersRemaining)} remain`,
      };
    }
    case 'FINAL_TABLE_FORMED':
      return { id, at, kind: 'FINAL_TABLE', tone: 'gold', eyebrow: 'Milestone', title: 'Final table', subtitle: `${formatCount(e.players.length)} players remain` };
    case 'TABLE_BROKEN':
      return { id, at, kind: 'TABLE_BROKEN', tone: 'info', eyebrow: 'Table break', title: `Table ${e.tableNumber} breaks`, subtitle: `${formatCount(e.playersMoved)} ${e.playersMoved === 1 ? 'player moves' : 'players move'} with their exact stacks` };
    case 'HAND_FOR_HAND':
      if (!e.enabled) return null;
      return { id, at, kind: 'HAND_FOR_HAND', tone: 'warning', eyebrow: 'On the bubble', title: 'Hand-for-hand', subtitle: 'Every table plays one hand at a time' };
    case 'MILESTONE':
      // "Tables reduced to N" fires once per broken table: the TABLE_BROKEN splash covers it.
      if (e.code.startsWith('TABLES_')) return null;
      return { id, at, kind: 'MILESTONE', tone: e.code === 'BUBBLE' ? 'warning' : 'gold', eyebrow: 'Milestone', title: titleCase(e.text), subtitle: `${formatCount(e.playersRemaining)} players remain` };
    case 'BLIND_LEVEL_CHANGED':
      return { id, at, kind: 'LEVEL_UP', tone: 'info', eyebrow: 'Blinds up', title: `Level ${e.to.level}`, subtitle: blindsText(e.to) };
    default:
      return null;
  }
}

function sentenceCase(text: string): string {
  if (text !== text.toUpperCase()) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCase(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}
