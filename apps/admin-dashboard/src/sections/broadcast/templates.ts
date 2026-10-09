import type { BlindLevel, TournamentEvent, TournamentStatus } from '@jpb/shared-types';
import type { IconName } from '@jpb/ui';
import { formatChips, formatCount, formatOrdinal } from '@jpb/ui';
import type { AnnounceScope, DisplayScene } from '../../api/types';

/**
 * §2.14 Broadcast: deterministic text only. Announcements come from fixed
 * templates with named placeholders filled from server data, and the
 * commentary lines are a pure function of one live event — the same event
 * always produces the same sentence. No AI, no randomness (docs/NO_AI.md).
 */

/** Server limit for an announcement (zod `max(280)` in the announce route). */
export const ANNOUNCE_MAX = 280;

// ---------------------------------------------------------------- audiences

export const SCOPE_META: Readonly<Record<AnnounceScope, { label: string; icon: IconName; hint: string }>> = {
  ALL: { label: 'Everyone', icon: 'users', hint: 'Every player, spectator and the big screen, as a tournament announcement.' },
  TABLE: { label: 'One table', icon: 'grid', hint: 'A private notice to each player seated at the chosen table.' },
  PLAYER: { label: 'One player', icon: 'user', hint: 'A private notice to one player, on every device they use.' },
  DISPLAY: { label: 'Big screen', icon: 'monitor', hint: 'Shown on the broadcast display. The server delivers it as a tournament announcement, so players see it too.' },
};

export const SCOPES: readonly AnnounceScope[] = ['ALL', 'TABLE', 'PLAYER', 'DISPLAY'];

// ---------------------------------------------------------------- display scenes

/** Scenes the broadcast display shows (API: POST /display { scene, featuredTableId? }). */
export const SCENES: ReadonlyArray<{ id: DisplayScene; label: string; icon: IconName; description: string }> = [
  { id: 'OVERVIEW', label: 'Overview', icon: 'monitor', description: 'Clock, blinds, players left, prize pool and the featured table.' },
  { id: 'LEADERBOARD', label: 'Leaderboard', icon: 'award', description: 'Current stack ranking (clearly labelled as live, not a result).' },
  { id: 'FINAL_TABLE', label: 'Final table', icon: 'crown', description: 'The final table seats, stacks and the action.' },
  { id: 'ANNOUNCEMENT', label: 'Announcement', icon: 'message', description: 'The latest big-screen announcement, full screen.' },
  { id: 'CHAMPION', label: 'Champion', icon: 'trophy', description: 'The champion’s splash. Available once the tournament is complete.' },
];

export function sceneLabel(scene: string | null | undefined): string {
  return SCENES.find((s) => s.id === scene)?.label ?? (scene ? scene.replace(/_/g, ' ').toLowerCase() : '—');
}

/** Why a scene cannot be chosen right now (null = available). */
export function sceneBlocked(scene: DisplayScene, status: TournamentStatus | null): string | null {
  if (scene === 'CHAMPION' && status !== 'COMPLETED') return 'No champion yet';
  return null;
}

/** Public URL of the broadcast display for this tournament (served by the game server under /display/). */
export function displayUrl(origin: string, tournamentId: string): string {
  return `${origin.replace(/\/+$/, '')}/display/?t=${encodeURIComponent(tournamentId)}`;
}

// ---------------------------------------------------------------- template context

export interface TemplateContext {
  tournament: string | null;
  level: BlindLevel | null;
  nextLevel: BlindLevel | null;
  remaining: number | null;
  registered: number | null;
  tables: number | null;
  averageStack: number | null;
  /** Average stack in big blinds, already formatted by the caller's rule. */
  averageBB: string | null;
  leader: { name: string; stack: number } | null;
  paidPlaces: number;
  winner: string | null;
  /** Whole minutes until the break ends (rounded up), when on a break. */
  breakMinutes: number | null;
  table: number | null;
  player: string | null;
}

export const EMPTY_CONTEXT: TemplateContext = {
  tournament: null,
  level: null,
  nextLevel: null,
  remaining: null,
  registered: null,
  tables: null,
  averageStack: null,
  averageBB: null,
  leader: null,
  paidPlaces: 0,
  winner: null,
  breakMinutes: null,
  table: null,
  player: null,
};

/** "750/1,500 + 1,500 ante" — blinds as players say them. */
export function blindsText(l: BlindLevel): string {
  return `${formatChips(l.smallBlind)}/${formatChips(l.bigBlind)}${l.ante > 0 ? ` + ${formatChips(l.ante)} ante` : ''}`;
}

type Resolver = (c: TemplateContext) => string | null;

/** Every placeholder a template may use, and how it is filled (null = data not available). */
export const PLACEHOLDERS: Readonly<Record<string, Resolver>> = {
  tournament: (c) => c.tournament,
  level: (c) => (c.level ? String(c.level.level) : null),
  blinds: (c) => (c.level ? blindsText(c.level) : null),
  nextLevel: (c) => (c.nextLevel ? String(c.nextLevel.level) : null),
  nextBlinds: (c) => (c.nextLevel ? blindsText(c.nextLevel) : null),
  remaining: (c) => (c.remaining !== null ? formatCount(c.remaining) : null),
  registered: (c) => (c.registered !== null ? formatCount(c.registered) : null),
  tables: (c) => (c.tables !== null ? formatCount(c.tables) : null),
  avgStack: (c) => (c.averageStack !== null ? formatChips(c.averageStack) : null),
  avgBB: (c) => c.averageBB,
  leader: (c) => c.leader?.name ?? null,
  leaderStack: (c) => (c.leader ? formatChips(c.leader.stack) : null),
  paidPlaces: (c) => (c.paidPlaces > 0 ? formatCount(c.paidPlaces) : null),
  bubbleToGo: (c) => (c.remaining !== null && c.paidPlaces > 0 && c.remaining > c.paidPlaces ? formatCount(c.remaining - c.paidPlaces) : null),
  winner: (c) => c.winner,
  minutes: (c) => (c.breakMinutes !== null ? formatCount(c.breakMinutes) : null),
  table: (c) => (c.table !== null ? String(c.table) : null),
  player: (c) => c.player,
};

const PLACEHOLDER_RE = /\{([a-zA-Z]+)\}/g;

export interface Filled {
  text: string;
  /** Placeholders that could not be filled (left as {name} in the text). */
  missing: string[];
}

/** Fills `{name}` placeholders. Unknown or unavailable ones stay visible and are reported. */
export function fillTemplate(template: string, ctx: TemplateContext): Filled {
  const missing: string[] = [];
  const text = template.replace(PLACEHOLDER_RE, (whole, name: string) => {
    const v = PLACEHOLDERS[name]?.(ctx) ?? null;
    if (v === null || v === '') {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    return v;
  });
  return { text, missing };
}

/** Human names of placeholders for "needs …" hints. */
export const PLACEHOLDER_LABEL: Readonly<Record<string, string>> = {
  tournament: 'tournament name',
  level: 'current level',
  blinds: 'current blinds',
  nextLevel: 'next level',
  nextBlinds: 'next level',
  remaining: 'players remaining',
  registered: 'registrations',
  tables: 'tables',
  avgStack: 'average stack',
  avgBB: 'average stack',
  leader: 'chip leader',
  leaderStack: 'chip leader',
  paidPlaces: 'prize places',
  bubbleToGo: 'players above the money',
  winner: 'champion',
  minutes: 'a running break',
  table: 'a table (pick one)',
  player: 'a player (pick one)',
};

export function missingText(missing: readonly string[]): string {
  return [...new Set(missing.map((m) => PLACEHOLDER_LABEL[m] ?? m))].join(', ');
}

// ---------------------------------------------------------------- templates

export type TemplateGroup = 'General' | 'Clock' | 'Milestones' | 'Table' | 'Player';

export interface AnnouncementTemplate {
  id: string;
  group: TemplateGroup;
  label: string;
  text: string;
  /** Audience the template is written for (picked with it). */
  scope: AnnounceScope;
}

export const TEMPLATES: readonly AnnouncementTemplate[] = [
  { id: 'welcome', group: 'General', scope: 'ALL', label: 'Welcome', text: 'Welcome to {tournament}! Good luck — keep your phone charged and on the venue Wi-Fi.' },
  { id: 'rules', group: 'General', scope: 'ALL', label: 'Fair play reminder', text: 'Reminder: one player per account, act only on your own device. The tournament director’s decisions are final.' },
  { id: 'quiet', group: 'General', scope: 'ALL', label: 'Quiet please', text: 'Please keep the playing area quiet — hands are in progress.' },
  { id: 'reconnect', group: 'General', scope: 'ALL', label: 'Connection help', text: 'Connection trouble? Reopen the tournament link. Your seat and chips are safe on the server.' },

  { id: 'level', group: 'Clock', scope: 'ALL', label: 'Current blinds', text: 'Level {level} is under way: blinds {blinds}.' },
  { id: 'next-level', group: 'Clock', scope: 'ALL', label: 'Next level', text: 'Blinds go up next level: {nextBlinds} (level {nextLevel}).' },
  { id: 'break-soon', group: 'Clock', scope: 'ALL', label: 'Break after this level', text: 'There is a break after this level. Please finish your hand as normal.' },
  { id: 'break-now', group: 'Clock', scope: 'ALL', label: 'On break', text: 'We are on a break. Play resumes in {minutes} minutes.' },
  { id: 'resume', group: 'Clock', scope: 'ALL', label: 'Back from break', text: 'The break is over and cards are in the air. Please return to your seat.' },

  { id: 'remain', group: 'Milestones', scope: 'ALL', label: 'Players remain', text: '{remaining} players remain. Average stack {avgStack} ({avgBB}).' },
  { id: 'leader', group: 'Milestones', scope: 'ALL', label: 'Chip leader', text: 'Chip leader: {leader} with {leaderStack} chips.' },
  { id: 'bubble', group: 'Milestones', scope: 'ALL', label: 'Money bubble', text: 'Money bubble: the top {paidPlaces} are paid — players to go before the money: {bubbleToGo}.' },
  { id: 'itm', group: 'Milestones', scope: 'ALL', label: 'In the money', text: 'The bubble has burst! Everyone left is in the money.' },
  { id: 'final-table', group: 'Milestones', scope: 'ALL', label: 'Final table', text: 'Final table reached! {remaining} players remain.' },
  { id: 'heads-up', group: 'Milestones', scope: 'ALL', label: 'Heads-up', text: 'Heads-up for the title of {tournament}!' },
  { id: 'champion', group: 'Milestones', scope: 'ALL', label: 'Champion', text: 'Congratulations to {winner}, champion of {tournament}!' },

  { id: 'table-break', group: 'Table', scope: 'TABLE', label: 'Table breaking', text: 'Table {table}: this table breaks soon. You will be moved automatically with your exact stack.' },
  { id: 'table-hold', group: 'Table', scope: 'TABLE', label: 'Floor check', text: 'Table {table}: short hold for a floor check. Your hand is safe; play resumes shortly.' },

  { id: 'player-seat', group: 'Player', scope: 'PLAYER', label: 'Return to seat', text: '{player}, please return to your seat — your hands are being folded on time.' },
  { id: 'player-desk', group: 'Player', scope: 'PLAYER', label: 'Come to the desk', text: '{player}, please come to the tournament desk.' },
];

export const TEMPLATE_GROUPS: readonly TemplateGroup[] = ['General', 'Clock', 'Milestones', 'Table', 'Player'];

/** Splash messages for the big screen (sent as a DISPLAY announcement + ANNOUNCEMENT scene). */
export const SPLASH_TEMPLATE_IDS: readonly string[] = ['final-table', 'itm', 'bubble', 'remain', 'heads-up', 'champion'];

// ---------------------------------------------------------------- commentary

export interface Commentary {
  /** Stable id (the event's sequence number). */
  id: string;
  at: number;
  icon: IconName;
  text: string;
}

/**
 * One commentary line per live event (pure: same event → same sentence), in
 * the fixed forms of docs/CONTRACTS.md ("{N} players remain", "Final table
 * reached", "{PLAYER} has been eliminated in {POS}").
 */
export function commentaryFor(event: TournamentEvent, tournament: string | null): { icon: IconName; text: string } | null {
  switch (event.kind) {
    case 'PLAYER_ELIMINATED': {
      const tie = event.record.tiedCount > 1 ? ` (tied with ${event.record.tiedCount - 1} ${event.record.tiedCount === 2 ? 'other' : 'others'})` : '';
      return { icon: 'x-circle', text: `${event.displayName} has been eliminated in ${formatOrdinal(event.record.finishPosition)}${tie}. ${formatCount(event.playersRemaining)} players remain.` };
    }
    case 'FINAL_TABLE_FORMED':
      return { icon: 'crown', text: `Final table reached: ${formatCount(event.players.length)} players remain.` };
    case 'BLIND_LEVEL_CHANGED':
      return { icon: 'clock', text: `Blinds are up: level ${event.to.level}, ${blindsText(event.to)}.` };
    case 'BREAK_STARTED':
      return { icon: 'coffee', text: event.message ? `Break time: ${event.message}` : 'Break time. Please be back at your seat before the clock restarts.' };
    case 'BREAK_ENDED':
      return { icon: 'play', text: 'The break is over. Cards are in the air.' };
    case 'TABLE_BROKEN':
      return { icon: 'split', text: `Table ${event.tableNumber} has broken; ${formatCount(event.playersMoved)} players moved to new seats.` };
    case 'HAND_FOR_HAND':
      return event.enabled ? { icon: 'pause', text: 'Hand-for-hand play is on: every table plays one hand at a time.' } : { icon: 'play', text: 'Hand-for-hand is over. Normal play resumes.' };
    case 'MILESTONE':
      return { icon: 'flame', text: event.text };
    case 'TOURNAMENT_COMPLETED':
      return { icon: 'trophy', text: tournament ? `${event.winnerName} wins ${tournament}!` : `${event.winnerName} is the champion!` };
    default:
      return null;
  }
}
