import { useCallback, useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { LeaderboardDto, LeaderboardRowDto } from '@jpb/shared-types';
import { Alert, Button, EmptyState, ErrorState, Icon, Panel, Skeleton, StatusPill, Tabs, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentState } from '../../live/useTournamentState';
import { formatTimeOfDay } from '../../lib/time';
import { DownloadButton } from '../reports/DownloadButton';
import { fileSlug } from '../reports/download';
import { finishColumns, stackColumns } from './columns';
import { STANDINGS_PAGE_SIZE, VIEW_META, hasStarted, parseView } from './model';
import type { StandingsView } from './model';
import { PrizeLadder } from './PrizeLadder';
import { SummaryStrip } from './SummaryStrip';
import { usePagedRows } from './usePagedRows';
import { VirtualGrid } from './VirtualGrid';
import './standings.css';

/** The live ranking moves every hand; finishing positions only on eliminations (live events also refresh both). */
const POLL_MS: Readonly<Record<StandingsView, number>> = { stack: 5_000, finish: 15_000 };

function tabLabel(v: StandingsView, total: number | null) {
  return (
    <>
      {VIEW_META[v].label}
      {total !== null && <span className="acr-standings-tabcount jpb-num">{formatCount(total)}</span>}
    </>
  );
}

function GridSkeleton() {
  return (
    <div className="acr-standings-skeleton" aria-busy="true" aria-label="Loading standings">
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} shape="block" height={40} />
      ))}
    </div>
  );
}

/** §2.12 Standings — current stack ranking (live) and finishing positions, with the prize ladder. */
export default function StandingsSection() {
  const tournamentId = useTournamentId();
  const api = useApi();
  const navigate = useNavigate();
  const descId = useId();
  const state = useTournamentState(tournamentId);
  const overview = state.overview.data;
  const [params, setParams] = useSearchParams();
  const view = parseView(params.get('view'));
  const setView = (v: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (v === 'finish') next.set('view', 'finish');
    else next.delete('view');
    return next;
  }, { replace: true });
  const canExport = usePermission('PLAYER_VIEW');
  const started = hasStarted(state.status);

  const keyFor = useCallback((offset: number, limit: number) => qk.standings(tournamentId, { mode: view, offset, limit }), [tournamentId, view]);
  const fetchPage = useCallback((offset: number, limit: number, signal: AbortSignal) => api.standings.get(tournamentId, { mode: view, offset, limit }, signal), [api, tournamentId, view]);
  const pages = usePagedRows<LeaderboardRowDto, LeaderboardDto>({ keyFor, fetchPage, pageSize: STANDINGS_PAGE_SIZE, resetKey: view, pollMs: POLL_MS[view], enabled: started });

  const counters = state.counters;
  const bigBlind = state.currentLevel?.bigBlind ?? null;
  const currency = overview?.config.prizeStructure.currency ?? 'INR';
  const ctx = { tournamentId, bigBlind, totalChips: counters?.totalChips ?? null, averageStack: overview?.stats.averageStack ?? null, leaderStack: overview?.stats.chipLeader?.stack ?? null, currency };
  const columns = view === 'stack' ? stackColumns(ctx) : finishColumns(ctx);
  const total = pages.total ?? 0;
  const meta = VIEW_META[view];
  const live = state.live && !pages.stale && pages.updatedAt > 0;

  // "Go to rank / place": index = rank − 1, or place − first place listed (ties skip places, so this holds).
  const [jumpText, setJumpText] = useState('');
  const [jump, setJump] = useState<{ index: number; seq: number } | null>(null);
  const firstPlace = pages.rowAt(0)?.finishPosition ?? (state.status === 'COMPLETED' ? 1 : (counters?.active ?? 0) + 1);
  const onJump = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(jumpText);
    if (!Number.isInteger(n) || n < 1) return;
    const index = view === 'stack' ? n - 1 : n - firstPlace;
    setJump((j) => ({ index: Math.max(0, Math.min(total - 1, index)), seq: (j?.seq ?? 0) + 1 }));
  };

  const tabs = useMemo(
    () => [
      { id: 'stack', label: tabLabel('stack', view === 'stack' ? pages.total : null) },
      { id: 'finish', label: tabLabel('finish', view === 'finish' ? pages.total : null) },
    ],
    [view, pages.total],
  );

  const openPlayer = useCallback((r: LeaderboardRowDto) => navigate(sectionHref('player-detail', tournamentId, { playerId: r.playerId })), [navigate, tournamentId]);

  if (state.overview.isLoading) {
    return (
      <div className="acr-page acr-standings" aria-busy="true" aria-label="Loading standings">
        <Skeleton shape="block" height={88} />
        <GridSkeleton />
      </div>
    );
  }

  const slug = fileSlug(overview?.joinCode ?? overview?.name ?? tournamentId);
  const body = !started ? (
    <EmptyState
      icon="award"
      title="Standings start with the first hand"
      description="Once the tournament starts, the live stack ranking and the finishing positions appear here."
      action={
        <ButtonLink to={sectionHref('registration', tournamentId)} icon="user">
          Registration
        </ButtonLink>
      }
    />
  ) : pages.initialLoading ? (
    <GridSkeleton />
  ) : pages.error ? (
    <ErrorState title="Could not load the standings" description={friendlyError(pages.error).description} onRetry={pages.refetch} />
  ) : total === 0 ? (
    <EmptyState
      icon={view === 'stack' ? 'users' : 'award'}
      title={view === 'stack' ? 'Nobody holds chips right now' : 'No finishing positions yet'}
      description={view === 'stack' ? 'Players appear here while they are seated, moving or suspended.' : 'Places are decided as players are eliminated. The first elimination will appear here.'}
    />
  ) : (
    <div className={cx('acr-standings-gridwrap', pages.stale && 'jpb-stale')} data-stale={pages.stale ? 'true' : undefined}>
      <VirtualGrid
        label={meta.label}
        describedBy={descId}
        total={total}
        rowAt={pages.rowAt}
        columns={columns}
        onRangeChange={pages.onRangeChange}
        onActivate={openPlayer}
        resetKey={view}
        jumpTo={jump}
        minWidth={view === 'stack' ? 760 : 680}
        rowClassName={(r) => (r.finishPosition === 1 ? 'acr-standings-row--champion' : r.status === 'SUSPENDED' ? 'acr-standings-row--suspended' : undefined)}
      />
    </div>
  );

  return (
    <div className="acr-page acr-standings">
      <PageHeader
        title="Standings"
        icon="award"
        eyebrow={overview?.name ?? 'Tournament'}
        description="Two different lists, always labelled: the live chip ranking of players still in, and the finishing positions decided so far. Both are paged on the server, so they work the same at 8 or 1,000,000 players."
        actions={
          <>
            {canExport && (
              <DownloadButton
                load={() => api.text('standingsCsv', { id: tournamentId }, { mode: view })}
                filename={`standings-${view === 'stack' ? 'stack-ranking' : 'finishing-positions'}-${slug}.csv`}
                what={`${meta.short.toLowerCase()} CSV`}
              >
                Export CSV
              </DownloadButton>
            )}
            <ButtonLink to={sectionHref('payouts', tournamentId)} icon="trophy">
              Payouts
            </ButtonLink>
            <ButtonLink to={sectionHref('players', tournamentId)} icon="users">
              Players
            </ButtonLink>
          </>
        }
      />

      <SummaryStrip tournamentId={tournamentId} counters={counters} stats={overview?.stats ?? null} bigBlind={bigBlind} />

      <div className="acr-standings-layout">
        <Panel flush className="acr-standings-main">
          <Tabs tabs={tabs} value={view} onChange={setView} label="Standings view" variant="segmented" className="acr-standings-tabs">
            <div className="acr-standings-explain" id={descId}>
              <Icon name={meta.icon} />
              <p>
                <strong>{meta.label}.</strong> {meta.description} <span className="acr-standings-kbd">↑ ↓ move between rows · Enter opens the player.</span>
              </p>
            </div>
            <div className="acr-standings-tools">
              {started && total > 0 && (
                <form className="acr-standings-jump" onSubmit={onJump} aria-label={view === 'stack' ? 'Go to a rank' : 'Go to a place'}>
                  <label className="acr-standings-jump__label">
                    <span>{view === 'stack' ? 'Go to rank' : 'Go to place'}</span>
                    <input
                      className="jpb-input acr-standings-jump__input"
                      inputMode="numeric"
                      value={jumpText}
                      placeholder={view === 'stack' ? `1–${formatCount(total)}` : `${formatCount(firstPlace)}+`}
                      onChange={(e) => setJumpText(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
                    />
                  </label>
                  <Button size="sm" variant="secondary" type="submit" icon="arrow-right" disabled={jumpText === ''}>
                    Go
                  </Button>
                </form>
              )}
              <span className="acr-standings-hint">
                {started && total > 0
                  ? `${formatCount(total)} ${view === 'stack' ? (total === 1 ? 'player in play' : 'players in play') : total === 1 ? 'place decided' : 'places decided'}`
                  : null}
              </span>
              <span className="acr-standings-headright">
                {started && pages.updatedAt > 0 && (
                  <span className={cx('acr-standings-updated', !live && 'is-stale')}>
                    {live ? <StatusPill size="sm" tone="positive" live label="Live" /> : <StatusPill size="sm" tone="warning" icon="wifi-off" label="Not live" />}
                    <span>
                      {pages.stale ? 'Last good data' : 'Updated'} {formatTimeOfDay(pages.updatedAt)}
                    </span>
                  </span>
                )}
                <Button size="sm" variant="ghost" icon="refresh" onClick={pages.refetch} disabled={!started}>
                  Refresh
                </Button>
              </span>
            </div>
            {pages.stale && (
              <div className="acr-standings-alert">
                <Alert severity="WARNING" title="Could not refresh the standings" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={pages.refetch}>Retry</Button>}>
                  The rows below are greyed: they are the last data received, not live.
                </Alert>
              </div>
            )}
            {body}
          </Tabs>
        </Panel>
        <aside className="acr-standings-side" aria-label="Prize ladder">
          <PrizeLadder prizes={overview?.config.prizeStructure ?? null} remaining={started ? (counters?.active ?? null) : null} status={state.status} />
        </aside>
      </div>
    </div>
  );
}
