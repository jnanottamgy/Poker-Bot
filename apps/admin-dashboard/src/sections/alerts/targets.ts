import { sectionHref } from '../../app/sections';
import type { IconName } from '@jpb/ui';

/**
 * Alert and audit targets are strings "<kind>:<id>" (docs/API.md, audit.ts):
 * `table:<tableId|number>`, `player:<playerId|publicId>`, `tournament:<id>`,
 * `node:<nodeId>`, `admin:<username>`, `session:<id>`, `alert:<id>`,
 * `entry:<entryId>`, or a bare word (`tournament`, `clock`, `display`).
 * This turns one into a human label and, when possible, a link to the screen
 * that shows it. Ids the detail screens cannot open directly (table numbers,
 * public ids) link to the list screen pre-filtered by search instead.
 */
export interface TargetInfo {
  kind: string;
  id: string | null;
  label: string;
  icon: IconName;
  /** In-app path (router basename excluded); null when nothing shows it. */
  href: string | null;
}

const PUBLIC_ID = /^JPN-[A-Z0-9]+$/i;
const DIGITS = /^\d+$/;

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${path}?${qs}` : path;
}

/** Splits "kind:id" (ids may themselves contain ':'). */
export function splitTarget(target: string): { kind: string; id: string | null } {
  const i = target.indexOf(':');
  if (i < 0) return { kind: target.trim(), id: null };
  const id = target.slice(i + 1).trim();
  return { kind: target.slice(0, i).trim(), id: id || null };
}

/** "Table 37 stalled …" → 37: the table number an alert message names (display only). */
function tableNumberIn(text: string | undefined): string | null {
  const m = text ? /\btable\s+#?(\d+)\b/i.exec(text) : null;
  return m ? (m[1] ?? null) : null;
}

/**
 * @param tournamentId tournament the target belongs to (the entry's/alert's
 *   own tournament first, else the current one); null on global screens.
 * @param hint free text about the target (an alert message) used to show a
 *   table number instead of an opaque table id.
 */
export function describeTarget(target: string | null, tournamentId: string | null, hint?: string): TargetInfo | null {
  if (!target) return null;
  const { kind, id } = splitTarget(target);
  switch (kind) {
    case 'table': {
      if (!id) return { kind, id, label: 'Table', icon: 'grid', href: tournamentId ? sectionHref('tables', tournamentId) : null };
      if (DIGITS.test(id)) return { kind, id, label: `Table ${id}`, icon: 'grid', href: tournamentId ? withQuery(sectionHref('tables', tournamentId), { q: id }) : null };
      const n = tableNumberIn(hint);
      return { kind, id, label: n ? `Table ${n}` : 'Table', icon: 'grid', href: tournamentId ? sectionHref('table-detail', tournamentId, { tableId: id }) : null };
    }
    case 'player': {
      if (!id) return { kind, id, label: 'Player', icon: 'user', href: null };
      if (PUBLIC_ID.test(id)) return { kind, id, label: id.toUpperCase(), icon: 'user', href: tournamentId ? withQuery(sectionHref('players', tournamentId), { q: id.toUpperCase() }) : null };
      return { kind, id, label: 'Player', icon: 'user', href: tournamentId ? sectionHref('player-detail', tournamentId, { playerId: id }) : null };
    }
    case 'tournament': {
      const tid = id ?? tournamentId;
      return { kind, id: tid, label: id ? `Tournament ${id}` : 'Tournament', icon: 'layers', href: tid ? sectionHref('overview', tid) : null };
    }
    case 'clock':
      return { kind, id, label: 'Blind clock', icon: 'clock', href: tournamentId ? sectionHref('clock', tournamentId) : null };
    case 'display':
    case 'scope':
      return { kind, id, label: id ? `Broadcast · ${id.toLowerCase()}` : 'Broadcast display', icon: 'message', href: tournamentId ? sectionHref('broadcast', tournamentId) : null };
    case 'node':
      return { kind, id, label: id ? `Node ${id}` : 'Node', icon: 'monitor', href: sectionHref('system', null) };
    case 'admin':
      return { kind, id, label: id ? `Admin ${id}` : 'Admin user', icon: 'key', href: sectionHref('users', null) };
    case 'session':
      return { kind, id, label: id ? `Session ${id}` : 'Admin session', icon: 'key', href: sectionHref('users', null) };
    case 'alert':
      return { kind, id, label: id ? `Alert ${id}` : 'Alert', icon: 'bell', href: tournamentId ? withQuery(sectionHref('alerts', tournamentId), id ? { alert: id } : {}) : null };
    case 'entry':
      return { kind, id, label: id ? `Payout entry ${id}` : 'Payout entry', icon: 'trophy', href: tournamentId ? withQuery(sectionHref('payouts', tournamentId), id ? { entry: id } : {}) : null };
    default:
      return { kind, id, label: target, icon: 'dot', href: null };
  }
}
