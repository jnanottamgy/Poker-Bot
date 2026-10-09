import { useMemo } from 'react';
import type { TournamentEventEnvelope } from '@jpb/shared-types';
import { Badge, Button, EmptyState, Icon, Panel, Skeleton } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { AnnounceScope } from '../../api/types';
import { usePermission } from '../../auth/permissions';
import { formatDateTime, formatTimeOfDay } from '../../lib/time';
import type { SentRecord } from './Composer';
import { SCOPE_META, commentaryFor } from './templates';
import type { Commentary } from './templates';

/** Commentary lines offered (newest first). */
const COMMENTARY_SHOWN = 8;
/** Announcements listed from the audit log. */
const LOG_LIMIT = 15;

export interface CommentaryProps {
  events: readonly TournamentEventEnvelope[];
  tournamentName: string | null;
  canSend: boolean;
  onUse: (text: string, scope: AnnounceScope) => void;
}

/** Deterministic commentary from the live tournament events of this connection. */
export function CommentaryPanel({ events, tournamentName, canSend, onUse }: CommentaryProps) {
  const lines = useMemo(() => {
    const out: Commentary[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < COMMENTARY_SHOWN; i--) {
      const env = events[i]!;
      const c = commentaryFor(env.event, tournamentName);
      if (c) out.push({ id: String(env.seq), at: env.at, ...c });
    }
    return out;
  }, [events, tournamentName]);

  return (
    <Panel
      title="Commentary"
      icon="activity"
      description={
        <>
          Ready-made lines from live events. <Badge tone="info">Fixed templates · no AI</Badge> The same event always gives the same sentence.
        </>
      }
      className="acr-broadcast-commentary"
    >
      {lines.length === 0 ? (
        <EmptyState compact icon="activity" title="Nothing to comment on yet" description="Eliminations, level changes, table breaks and milestones appear here as they happen." />
      ) : (
        <ol className="acr-broadcast-lines">
          {lines.map((l) => (
            <li key={l.id} className="acr-broadcast-line">
              <span className="acr-broadcast-line__icon" aria-hidden="true">
                <Icon name={l.icon} />
              </span>
              <span className="acr-broadcast-line__body">
                <span className="acr-broadcast-line__text">{l.text}</span>
                <time className="acr-broadcast-dim">{formatTimeOfDay(l.at)}</time>
              </span>
              <span className="acr-broadcast-line__actions">
                <Button size="sm" variant="ghost" icon="message" disabled={!canSend} onClick={() => onUse(l.text, 'ALL')} aria-label={`Use for everyone: ${l.text}`}>
                  Use
                </Button>
                <Button size="sm" variant="ghost" icon="monitor" disabled={!canSend} onClick={() => onUse(l.text, 'DISPLAY')} aria-label={`Use for the big screen: ${l.text}`}>
                  Screen
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

interface AuditAnnounce {
  text?: string;
  scope?: AnnounceScope;
  recipients?: number;
  /** Announcements routed through Johnny (ALL / DISPLAY) keep the director input here. */
  input?: { type?: string; text?: string } | null;
}

/** The announced text, wherever the server recorded it (table/player notices vs director input). */
export function announcedText(after: AuditAnnounce | null): string | null {
  return after?.text ?? after?.input?.text ?? null;
}

function scopeOfTarget(target: string, after: AuditAnnounce | null): { scope: AnnounceScope | null; label: string } {
  if (after?.scope && after.scope in SCOPE_META) {
    const s = after.scope;
    if (s === 'TABLE' || s === 'PLAYER') return { scope: s, label: `${SCOPE_META[s].label}${after.recipients !== undefined ? ` · ${after.recipients} recipients` : ''}` };
    return { scope: s, label: SCOPE_META[s].label };
  }
  const m = /^scope:(ALL|DISPLAY)$/.exec(target);
  if (m) return { scope: m[1] as AnnounceScope, label: SCOPE_META[m[1] as AnnounceScope].label };
  if (target.startsWith('table:')) return { scope: 'TABLE', label: SCOPE_META.TABLE.label };
  if (target.startsWith('player:')) return { scope: 'PLAYER', label: SCOPE_META.PLAYER.label };
  return { scope: null, label: target };
}

/**
 * Announcements sent for this tournament: the audit log (who sent what, to
 * whom) when the admin may read it, otherwise what this console sent and
 * what arrived live.
 */
export function AnnouncementLog({ tournamentId, sent, events }: { tournamentId: string; sent: readonly SentRecord[]; events: readonly TournamentEventEnvelope[] }) {
  const api = useApi();
  const canAudit = usePermission('AUDIT_VIEW');
  const q = { tournamentId, action: 'ANNOUNCE', limit: LOG_LIMIT };
  const audit = useQuery(qk.audit(q), (s) => api.audit.list(q, s), { enabled: canAudit, pollMs: 30_000 });
  const live = useMemo(() => events.filter((e) => e.event.kind === 'ANNOUNCEMENT').slice(-LOG_LIMIT).reverse(), [events]);

  let body;
  if (canAudit) {
    const entries = audit.data?.entries ?? [];
    body = audit.isLoading ? (
      <Skeleton lines={4} />
    ) : audit.error && !audit.data ? (
      <p className="acr-broadcast-dim">The audit log could not be read right now.</p>
    ) : entries.length === 0 ? (
      <EmptyState compact icon="message" title="No announcement yet" description="Everything sent from the control room is listed here with who sent it." />
    ) : (
      <ol className="acr-broadcast-log">
        {entries.map((e) => {
          const after = (e.afterState ?? null) as AuditAnnounce | null;
          const s = scopeOfTarget(e.target, after);
          return (
            <li key={e.id}>
              <span className="acr-broadcast-log__head">
                <span className="acr-broadcast-log__scope">
                  <Icon name={s.scope ? SCOPE_META[s.scope].icon : 'message'} /> {s.label}
                </span>
                <span className="acr-broadcast-dim">
                  {e.adminUsername} · {formatDateTime(e.at)}
                </span>
              </span>
              <span className="acr-broadcast-log__text">{announcedText(after) ?? <span className="acr-broadcast-dim">(text not recorded)</span>}</span>
            </li>
          );
        })}
      </ol>
    );
  } else {
    const items = [
      ...sent.map((r) => ({ key: `s${r.id}`, at: r.at, label: `${SCOPE_META[r.scope].label}${r.target ? ` · ${r.target}` : ''} · you`, text: r.text, icon: SCOPE_META[r.scope].icon })),
      ...live.map((e) => ({ key: `e${e.seq}`, at: e.at, label: e.event.kind === 'ANNOUNCEMENT' && e.event.from === 'DIRECTOR' ? 'Johnny (director)' : 'Tournament announcement', text: e.event.kind === 'ANNOUNCEMENT' ? e.event.text : '', icon: 'message' as const })),
    ].sort((a, b) => b.at - a.at);
    body =
      items.length === 0 ? (
        <EmptyState compact icon="message" title="No announcement yet" description="Announcements sent or received while this page is open appear here." />
      ) : (
        <ol className="acr-broadcast-log">
          {items.map((it) => (
            <li key={it.key}>
              <span className="acr-broadcast-log__head">
                <span className="acr-broadcast-log__scope">
                  <Icon name={it.icon} /> {it.label}
                </span>
                <span className="acr-broadcast-dim">{formatTimeOfDay(it.at)}</span>
              </span>
              <span className="acr-broadcast-log__text">{it.text}</span>
            </li>
          ))}
        </ol>
      );
  }

  return (
    <Panel title="Announcement log" icon="file" description={canAudit ? 'From the audit log: who sent what, to whom.' : 'This session only (the full history needs AUDIT_VIEW).'} className="acr-broadcast-logpanel">
      {body}
    </Panel>
  );
}
