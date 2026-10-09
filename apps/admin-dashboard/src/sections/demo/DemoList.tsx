import { ApiError } from '@jpb/client-sdk';
import type { TournamentListItemDto } from '@jpb/shared-types';
import { Button, Icon, ProgressBar, StatusPill, TOURNAMENT_STATUS_META, cx, formatCount } from '@jpb/ui';
import { useApi, useQueryClient } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { ButtonLink } from '../../components/ButtonLink';
import { useDangerousAction } from '../../danger/DangerProvider';
import { formatDateTime, formatDuration } from '../../lib/time';
import { displayUrl, isTerminal, throughput } from './model';

/** Live demos poll their status this often (hands, actions, players remaining). */
export const DEMO_POLL_MS = 3_000;

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });

/** One demo: live status from GET /demo/:id (polled while running), throughput and its controls. */
export function DemoRow({ t, now, selected, canRun, onSelect }: { t: TournamentListItemDto; now: number; selected: boolean; canRun: boolean; onSelect: () => void }) {
  const api = useApi();
  const danger = useDangerousAction();
  const client = useQueryClient();
  const live = !isTerminal(t.status);
  // A demo whose bots are gone (404) has nothing live to poll.
  const prev = client.getState(qk.demo(t.id));
  const gone = prev.data === undefined && prev.error instanceof ApiError && prev.error.status === 404;
  const status = useQuery(qk.demo(t.id), (s) => api.demo.status(t.id, s), { enabled: canRun, pollMs: live && !gone ? DEMO_POLL_MS : undefined, staleMs: live ? 1_000 : 60_000 });
  const d = status.data;
  const detached = !d && status.error instanceof ApiError && status.error.status === 404;
  const running = d ? d.running : false;
  const tStatus = d?.status ?? t.status;
  const meta = TOURNAMENT_STATUS_META[tStatus];
  const tp = d ? throughput(d, isTerminal(tStatus) && t.completedAt ? t.completedAt : now) : null;
  const players = d?.players ?? t.registered;
  const remaining = d?.playersRemaining ?? t.active;

  const stop = () =>
    void danger({
      level: 1,
      endpoint: 'demoStop',
      title: `Stop ${t.name}`,
      summary: 'Cancels the demo tournament and disconnects its bots. The hands played so far stay in the history.',
      consequences: [`${formatCount(remaining)} bots still in play are removed`, 'Standings freeze as they are; the server seed can then be revealed'],
      tone: 'danger',
      confirmLabel: 'Stop demo',
      run: () => api.demo.stop(t.id),
      success: 'Demo stopped',
      invalidate: [qk.demo(t.id), qk.tournamentsAll(), qk.tournament(t.id)],
    });

  return (
    <li className={cx('acr-demo-row', selected && 'is-selected', running && 'is-running', status.isStale && 'jpb-stale')} aria-current={selected || undefined}>
      <div className="acr-demo-row__head">
        <button type="button" className="acr-demo-row__name" onClick={onSelect} aria-pressed={selected}>
          {t.name}
        </button>
        <span className="jpb-mono acr-demo-dim">{t.joinCode}</span>
        <StatusPill size="sm" tone={meta.tone} icon={meta.icon} label={meta.label} live={running} />
        {running && <span className="acr-demo-live">bots playing</span>}
        {detached && (
          <span className="acr-demo-detached" title="The bots ran on a server process that has since restarted; only the tournament remains.">
            <Icon name="wifi-off" /> bots not attached
          </span>
        )}
      </div>

      <div className="acr-demo-row__stats" aria-label={`Live status of ${t.name}`}>
        <div>
          <span className="acr-demo-stat__label">Players left</span>
          <span className="acr-demo-stat__value jpb-num">
            {formatCount(remaining)}
            <span className="acr-demo-dim"> / {formatCount(players)}</span>
          </span>
        </div>
        <div>
          <span className="acr-demo-stat__label">Hands</span>
          <span className="acr-demo-stat__value jpb-num">{d ? formatCount(d.handsCompleted) : '—'}</span>
        </div>
        <div>
          <span className="acr-demo-stat__label">Actions</span>
          <span className="acr-demo-stat__value jpb-num">{d ? formatCount(d.actionsSubmitted) : '—'}</span>
        </div>
        <div>
          <span className="acr-demo-stat__label">Hands / min</span>
          <span className="acr-demo-stat__value jpb-num">{tp ? fmt1(tp.handsPerMinute) : '—'}</span>
        </div>
        <div>
          <span className="acr-demo-stat__label">Actions / s</span>
          <span className="acr-demo-stat__value jpb-num">{tp ? fmt1(tp.actionsPerSecond) : '—'}</span>
        </div>
        <div>
          <span className="acr-demo-stat__label">{running ? 'Running for' : 'Ran for'}</span>
          <span className="acr-demo-stat__value jpb-num">{tp ? formatDuration(tp.elapsedMs) : '—'}</span>
        </div>
      </div>

      <ProgressBar
        className="acr-demo-row__progress"
        label="Field eliminated"
        value={players - remaining}
        max={Math.max(1, players - 1)}
        valueText={`${formatCount(players - remaining)} of ${formatCount(Math.max(0, players - 1))} to a winner`}
        tone={tStatus === 'COMPLETED' ? 'gold' : running ? 'positive' : 'neutral'}
      />

      <div className="acr-demo-row__foot">
        <span className="acr-demo-dim">
          Started {formatDateTime(d?.startedAt ?? t.startedAt ?? t.createdAt)}
          {status.isStale ? ' · status not current' : ''}
        </span>
        <span className="acr-demo-row__actions">
          <ButtonLink to={sectionHref('overview', t.id)} icon="activity">
            Control room
          </ButtonLink>
          <ButtonLink to={sectionHref('tables', t.id)} icon="grid">
            Tables
          </ButtonLink>
          <a className="jpb-btn jpb-btn--secondary jpb-btn--sm acr-buttonlink" href={displayUrl(t.joinCode)} target="_blank" rel="noreferrer">
            <Icon name="monitor" className="jpb-btn__icon" />
            <span className="jpb-btn__label">Big screen</span>
            <span className="jpb-sr-only"> (opens in a new tab)</span>
          </a>
          {isTerminal(tStatus) && (
            <ButtonLink to={sectionHref('reports', t.id)} icon="download">
              Results
            </ButtonLink>
          )}
          {running && canRun && (
            <Button size="sm" variant="danger-outline" icon="ban" onClick={stop}>
              Stop
            </Button>
          )}
        </span>
      </div>
    </li>
  );
}
