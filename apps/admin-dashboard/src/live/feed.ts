import type { AuditEntryDto, TournamentEventEnvelope } from '@jpb/shared-types';
import type { ActivityEntry } from '@jpb/ui';
import { formatChips, formatCount, formatOrdinal } from '@jpb/ui';
import { formatTimeOfDay } from '../lib/time';

export type FeedKind = 'elimination' | 'move' | 'table' | 'milestone' | 'clock' | 'admin' | 'integrity' | 'other';

export interface FeedEntry extends ActivityEntry {
  at: number;
  kind: FeedKind;
}

/** Turns one live tournament event into a feed line (text + severity; never colour alone). */
export function eventToFeed(env: TournamentEventEnvelope): FeedEntry | null {
  const e = env.event;
  const base = { id: `ev-${env.seq}`, at: env.at, time: formatTimeOfDay(env.at), actor: 'Johnny' };
  switch (e.kind) {
    case 'PLAYER_ELIMINATED':
      return { ...base, kind: 'elimination', action: 'ELIMINATED', target: `${e.displayName} — ${formatOrdinal(e.record.finishPosition)}${e.record.tiedCount > 1 ? ` (tied ×${e.record.tiedCount})` : ''}`, detail: `${formatCount(e.playersRemaining)} players remain` };
    case 'TABLE_MOVE':
      return { ...base, kind: 'move', action: e.movement.reason === 'TABLE_BREAK' ? 'TABLE_BREAK_MOVE' : 'BALANCE_MOVE', target: `T${e.fromTableNumber ?? '—'} → T${e.toTableNumber} seat ${e.movement.toSeat + 1} · ${formatChips(e.movement.stack)} chips` };
    case 'TABLE_BROKEN':
      return { ...base, kind: 'table', action: 'TABLE_BROKEN', target: `Table ${e.tableNumber} → ${e.playersMoved} players moved`, severity: 'warning' };
    case 'TABLE_CREATED':
      return { ...base, kind: 'table', action: 'TABLE_CREATED', target: `Table ${e.tableNumber}` };
    case 'FINAL_TABLE_FORMED':
      return { ...base, kind: 'milestone', action: 'FINAL_TABLE', target: `${e.players.length} players`, severity: 'gold' };
    case 'MILESTONE':
      return { ...base, kind: 'milestone', action: 'MILESTONE', target: e.text, severity: 'gold' };
    case 'BLIND_LEVEL_CHANGED':
      return { ...base, kind: 'clock', action: 'LEVEL_UP', target: `Level ${e.to.level} · ${formatChips(e.to.smallBlind)} / ${formatChips(e.to.bigBlind)}${e.to.ante ? ` · ante ${formatChips(e.to.ante)}` : ''}` };
    case 'BREAK_STARTED':
      return { ...base, kind: 'clock', action: 'BREAK_STARTED', target: e.message ?? 'Break', severity: 'warning' };
    case 'BREAK_ENDED':
      return { ...base, kind: 'clock', action: 'BREAK_ENDED', target: 'Play resumes' };
    case 'TOURNAMENT_PAUSED':
      return { ...base, kind: 'admin', action: e.mode === 'EMERGENCY_FREEZE' ? 'EMERGENCY_FREEZE' : 'PAUSED', target: 'All tables', reason: e.reason ?? undefined, severity: e.mode === 'EMERGENCY_FREEZE' ? 'critical' : 'warning' };
    case 'TOURNAMENT_RESUMED':
      return { ...base, kind: 'admin', action: 'RESUMED', target: 'All tables' };
    case 'TOURNAMENT_STATUS_CHANGED':
      return { ...base, kind: 'admin', action: 'STATUS', target: `${e.from.replace(/_/g, ' ').toLowerCase()} → ${e.to.replace(/_/g, ' ').toLowerCase()}`, reason: e.reason ?? undefined };
    case 'HAND_FOR_HAND':
      return { ...base, kind: 'clock', action: 'HAND_FOR_HAND', target: e.enabled ? 'On' : 'Off', severity: 'warning' };
    case 'ANNOUNCEMENT':
      return { ...base, actor: e.from === 'ADMIN' ? 'Admin' : 'Johnny', kind: 'admin', action: 'ANNOUNCEMENT', target: e.text };
    case 'INTEGRITY_ALERT':
      return { ...base, kind: 'integrity', action: e.code, target: e.detail, severity: e.severity === 'CRITICAL' ? 'critical' : 'warning' };
    case 'TOURNAMENT_COMPLETED':
      return { ...base, kind: 'milestone', action: 'CHAMPION', target: e.winnerName, severity: 'gold' };
    default:
      return null;
  }
}

/** An admin override from the audit log as a feed line (actor, action code, target, quoted reason). */
export function auditToFeed(e: AuditEntryDto): FeedEntry {
  return {
    id: `au-${e.seq}`,
    at: e.at,
    time: formatTimeOfDay(e.at),
    actor: e.adminUsername,
    action: e.action,
    target: e.target,
    reason: e.reason ?? undefined,
    kind: 'admin',
    severity: /FREEZE|CANCEL|DISQUALIFY|ADJUST|BREAK_TABLE|REVEAL/.test(e.action) ? 'critical' : 'info',
  };
}
