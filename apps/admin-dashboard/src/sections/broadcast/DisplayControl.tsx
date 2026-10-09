import { useId, useState } from 'react';
import type { Paginated, TableListItemDto, TournamentStatus } from '@jpb/shared-types';
import { Button, Icon, IconButton, Panel, Skeleton, cx, useToast } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useMutation } from '../../api/query/useMutation';
import { useQuery } from '../../api/query/useQuery';
import type { DisplayScene } from '../../api/types';
import { usePermission } from '../../auth/permissions';
import { useDangerousAction } from '../../danger/DangerProvider';
import { formatDateTime, formatTimeOfDay } from '../../lib/time';
import { TargetPicker } from './TargetPicker';
import type { PickedTable } from './TargetPicker';
import { SCENES, SPLASH_TEMPLATE_IDS, TEMPLATES, displayUrl, fillTemplate, missingText, sceneBlocked, sceneLabel } from './templates';
import type { TemplateContext } from './templates';

/** Tolerance between this console's clock estimate and the server's audit timestamps. */
const CLOCK_SKEW_MS = 5_000;

export interface AppliedDisplay {
  scene: DisplayScene;
  featured: PickedTable | null;
  at: number;
  /** Who set it: this console, or an admin from the audit log. */
  by: string;
}

interface AuditDisplayState {
  scene?: string;
  featuredTableId?: string | null;
  /** The game server audits the director input (SET_FEATURED_TABLE), not the scene. */
  input?: { type?: string; tableId?: string | null } | null;
}

/** Featured table of a DISPLAY_SCENE audit entry: undefined when the entry does not say. */
function featuredOf(after: AuditDisplayState | null): string | null | undefined {
  if (!after) return undefined;
  if ('featuredTableId' in after) return after.featuredTableId ?? null;
  if (after.input && 'tableId' in after.input) return after.input.tableId ?? null;
  return undefined;
}

/** The last display change in the audit log (who / when / what). There is no GET for the display state. */
function LastChange({ tournamentId, local }: { tournamentId: string; local: AppliedDisplay | null }) {
  const api = useApi();
  const canAudit = usePermission('AUDIT_VIEW');
  const q = { tournamentId, action: 'DISPLAY_SCENE', limit: 1 };
  const audit = useQuery(qk.audit(q), (s) => api.audit.list(q, s), { enabled: canAudit, staleMs: 10_000 });
  const entry = audit.data?.entries[0] ?? null;
  const after = (entry?.afterState ?? null) as AuditDisplayState | null;
  // Our own change is also in the audit log (stamped by the server clock): only a clearly later entry is someone else's.
  if (local && (!entry || entry.at <= local.at + CLOCK_SKEW_MS)) {
    return (
      <p className="acr-broadcast-current">
        <Icon name="check-circle" /> On screen: <strong>{sceneLabel(local.scene)}</strong>
        {local.featured ? ` · featured ${local.featured.label}` : ' · no featured table'} <span className="acr-broadcast-dim">— set by you at {formatTimeOfDay(local.at)}</span>
      </p>
    );
  }
  if (!canAudit) return <p className="acr-broadcast-current acr-broadcast-dim">The current scene is not reported by the server; apply a scene to be sure what is on screen.</p>;
  if (audit.isLoading) return <Skeleton width="60%" />;
  if (!entry) return <p className="acr-broadcast-current acr-broadcast-dim">No scene has been set yet — the display shows its default (Overview).</p>;
  return (
    <p className="acr-broadcast-current">
      <Icon name="file" /> Last change: <strong>{after?.scene ? sceneLabel(after.scene) : 'scene changed'}</strong>
      {featuredOf(after) === undefined ? '' : featuredOf(after) ? ' · with a featured table' : ' · no featured table'} <span className="acr-broadcast-dim">— {entry.adminUsername}, {formatDateTime(entry.at)}</span>
    </p>
  );
}

export interface DisplayControlProps {
  tournamentId: string;
  joinCode: string | null;
  status: TournamentStatus | null;
  canControl: boolean;
  ctx: TemplateContext;
  applied: AppliedDisplay | null;
  onApplied: (a: AppliedDisplay) => void;
  now: () => number;
}

/**
 * §2.14 "Control the broadcast display: featured table, scene (overview,
 * leaderboard, final table, announcement, champion), milestone splash".
 */
export function DisplayControl({ tournamentId, joinCode, status, canControl, ctx, applied, onApplied, now }: DisplayControlProps) {
  const api = useApi();
  const toast = useToast();
  const danger = useDangerousAction();
  const id = useId();
  const [scene, setScene] = useState<DisplayScene>(applied?.scene ?? 'OVERVIEW');
  const [featured, setFeatured] = useState<PickedTable | null>(applied?.featured ?? null);
  const url = displayUrl(typeof window === 'undefined' ? '' : window.location.origin, tournamentId, joinCode);

  // At the final table there is one table left: offer it in one click.
  const finalQ = { sort: 'players' as const, offset: 0, limit: 2 };
  const tables = useQuery<Paginated<TableListItemDto>>(qk.tables(tournamentId, finalQ), (s) => api.tables.list(tournamentId, finalQ, s), { enabled: status === 'FINAL_TABLE' });
  const finalTable = tables.data?.rows.find((t) => t.isFinalTable) ?? null;

  const apply = useMutation(
    (v: { scene: DisplayScene; featured: PickedTable | null }) => api.broadcast.display(tournamentId, { scene: v.scene, featuredTableId: v.featured?.id ?? null }),
    {
      success: (_r, v) => `Big screen: ${sceneLabel(v.scene)}${v.featured ? ` · ${v.featured.label}` : ''}`,
      invalidate: [qk.auditAll()],
      onSuccess: (_r, v) => onApplied({ scene: v.scene, featured: v.featured, at: now(), by: 'you' }),
    },
  );

  const dirty = !applied || applied.scene !== scene || (applied.featured?.id ?? null) !== (featured?.id ?? null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.push({ tone: 'success', title: 'Display link copied' });
    } catch {
      toast.push({ tone: 'warning', title: 'Could not copy', description: 'Select the link and copy it manually.' });
    }
  };

  const splash = (templateId: string) => {
    const tpl = TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    const { text } = fillTemplate(tpl.text, ctx);
    // Two requests: if the scene change fails, "retry" in the dialog must not announce twice.
    let announced = false;
    void danger({
      level: 1,
      endpoint: 'announce',
      title: `Splash “${tpl.label}” on the big screen`,
      summary: `“${text}”`,
      consequences: ['The display switches to the Announcement scene and shows this message full screen', 'The server also delivers it to players as a tournament announcement', 'Recorded in the audit log under your name'],
      confirmLabel: 'Show splash',
      run: async () => {
        if (!announced) {
          await api.broadcast.announce(tournamentId, { text, scope: 'DISPLAY' });
          announced = true;
        }
        await api.broadcast.display(tournamentId, { scene: 'ANNOUNCEMENT', featuredTableId: featured?.id ?? null });
        return true;
      },
      success: `Splash on the big screen: ${tpl.label}`,
      invalidate: [qk.auditAll()],
      onSuccess: () => {
        setScene('ANNOUNCEMENT');
        onApplied({ scene: 'ANNOUNCEMENT', featured, at: now(), by: 'you' });
      },
    });
  };

  return (
    <>
      <Panel
        title="Broadcast display"
        icon="monitor"
        description="What the projector / TV / OBS screen shows. Public data only — never hole cards."
        className="acr-broadcast-display"
        actions={
          <a className="jpb-btn jpb-btn--secondary jpb-btn--sm acr-buttonlink" href={url} target="_blank" rel="noopener noreferrer">
            <Icon name="eye" className="jpb-btn__icon" />
            <span className="jpb-btn__label">Open display</span>
          </a>
        }
      >
        <div className="acr-broadcast-url">
          <span className="jpb-mono" title={url}>
            {url}
          </span>
          <IconButton icon="layers" size="sm" label="Copy display link" onClick={() => void copy()} />
        </div>
        <LastChange tournamentId={tournamentId} local={applied} />

        <fieldset className="acr-broadcast-scenes" disabled={!canControl}>
          <legend className="acr-broadcast-legend">Scene</legend>
          {SCENES.map((s) => {
            const blocked = sceneBlocked(s.id, status);
            return (
              <label key={s.id} className={cx('acr-broadcast-scene', scene === s.id && 'is-on', blocked && 'is-blocked', applied?.scene === s.id && 'is-live')}>
                <input type="radio" name={`${id}-scene`} value={s.id} checked={scene === s.id} disabled={blocked !== null} onChange={() => setScene(s.id)} />
                <span className="acr-broadcast-scene__icon" aria-hidden="true">
                  <Icon name={s.icon} />
                </span>
                <span className="acr-broadcast-scene__text">
                  <strong>
                    {s.label}
                    {applied?.scene === s.id && <span className="acr-broadcast-scene__live"> · on screen</span>}
                  </strong>
                  <small>{blocked ?? s.description}</small>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="acr-broadcast-featured">
          <TargetPicker kind="table" tournamentId={tournamentId} value={featured} onChange={setFeatured} label="Featured table" disabled={!canControl} hint="Shown live on the Overview scene. Leave empty to let the display choose." />
          {finalTable && featured?.id !== finalTable.tableId && (
            <Button size="sm" variant="ghost" icon="crown" disabled={!canControl} onClick={() => setFeatured({ kind: 'table', id: finalTable.tableId, tableNumber: finalTable.tableNumber, label: `Table ${finalTable.tableNumber}` })}>
              Feature the final table (T{finalTable.tableNumber})
            </Button>
          )}
        </div>

        <div className="acr-broadcast-actions">
          <span className="acr-broadcast-dim">{dirty ? `Will show: ${sceneLabel(scene)}${featured ? ` · ${featured.label}` : ''}` : 'This is what the display shows now.'}</span>
          <Button variant="primary" icon="monitor" disabled={!canControl || !dirty} loading={apply.pending} loadingLabel="Applying…" onClick={() => apply.mutate({ scene, featured })}>
            Apply to big screen
          </Button>
        </div>
      </Panel>

      <Panel title="Milestone splash" icon="flame" description="One click: a full-screen message on the big screen from a fixed template." className="acr-broadcast-splash">
        <div className="acr-broadcast-splashgrid">
          {SPLASH_TEMPLATE_IDS.map((tid) => {
            const tpl = TEMPLATES.find((t) => t.id === tid)!;
            const f = fillTemplate(tpl.text, ctx);
            const blocked = f.missing.length > 0;
            return (
              <button key={tid} type="button" className={cx('acr-broadcast-splashbtn', blocked && 'is-blocked')} disabled={!canControl || blocked} onClick={() => splash(tid)} title={blocked ? `Needs ${missingText(f.missing)}` : f.text}>
                <strong>{tpl.label}</strong>
                <small>{blocked ? `Needs ${missingText(f.missing)}` : f.text}</small>
              </button>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
