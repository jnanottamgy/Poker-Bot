import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { DemoStatusDto } from '@jpb/shared-types';
import { Button, EmptyState, ErrorState, Icon, Panel, Skeleton, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { usePermission } from '../../auth/permissions';
import { PageHeader } from '../../components/PageHeader';
import { useNow } from '../alerts/useNow';
import { CreateDemo } from './CreateDemo';
import { DemoRow } from './DemoList';
import { isTerminal } from './model';
import './demo.css';

const LIST_POLL_MS = 10_000;
const PAGE = 20;
const SIMS = { simulations: true } as const;

/** §2.20 Demo & simulation — create bot tournaments, watch them live, stop them, read their throughput. */
export default function DemoSection() {
  const api = useApi();
  const canRun = usePermission('SIMULATION_RUN', null);
  const canList = usePermission('PLAYER_VIEW', null);
  const list = useQuery(qk.tournaments(SIMS), (s) => api.tournaments.list(SIMS, s), { enabled: canList, pollMs: LIST_POLL_MS });
  const [params, setParams] = useSearchParams();
  const selected = params.get('demo');
  const [filter, setFilter] = useState<'all' | 'running'>('all');
  const [shownCount, setShownCount] = useState(PAGE);
  const now = useNow(1_000);

  const select = useCallback(
    (id: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set('demo', id);
          else next.delete('demo');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const demos = useMemo(() => (list.data?.tournaments ?? []).filter((t) => t.isSimulation).sort((a, b) => b.createdAt - a.createdAt), [list.data]);
  const running = demos.filter((t) => !isTerminal(t.status));
  const visible = (filter === 'running' ? running : demos).slice(0, shownCount);
  const botsInPlay = running.reduce((a, t) => a + t.active, 0);
  const onCreated = (d: DemoStatusDto) => {
    setFilter('all');
    select(d.tournamentId);
  };

  const header = (
    <PageHeader
      title="Demo & simulation"
      icon="zap"
      description="Run complete tournaments with deterministic bots to rehearse an event, demo the product or load-test the cluster. Bots follow fixed rules — no AI."
    />
  );

  if (!canRun) {
    return (
      <div className="acr-page acr-demo">
        {header}
        <EmptyState icon="lock" title="Demos are restricted" description="Running demos and simulations requires the SIMULATION_RUN permission." />
      </div>
    );
  }

  return (
    <div className="acr-page acr-demo">
      {header}
      <div className="acr-demo-layout">
        <CreateDemo onCreated={onCreated} locked={!canRun} />
        <Panel
          flush
          title="Demos"
          icon="layers"
          className={cx('acr-demo-list', list.isStale && 'jpb-stale')}
          description={list.data ? `${formatCount(running.length)} running · ${formatCount(botsInPlay)} bots in play · ${formatCount(demos.length)} in total` : 'Simulation tournaments on this server'}
          actions={
            <span className="acr-demo-listactions">
              <span className="acr-demo-seg" role="group" aria-label="Which demos">
                <button type="button" className={cx(filter === 'all' && 'is-on')} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                  All <span className="jpb-num">{formatCount(demos.length)}</span>
                </button>
                <button type="button" className={cx(filter === 'running' && 'is-on')} aria-pressed={filter === 'running'} onClick={() => setFilter('running')}>
                  Running <span className="jpb-num">{formatCount(running.length)}</span>
                </button>
              </span>
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => void list.refetch()}>
                Refresh
              </Button>
            </span>
          }
        >
          {list.isLoading ? (
            <div className="acr-demo-pad" aria-busy="true" aria-label="Loading demos">
              <Skeleton shape="block" height={150} />
              <Skeleton shape="block" height={150} />
            </div>
          ) : !list.data ? (
            <ErrorState title="Could not load the demos" description={friendlyError(list.error).description} onRetry={() => void list.refetch()} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="zap"
              title={filter === 'running' && demos.length > 0 ? 'No demo is running' : 'No demos yet'}
              description="Pick a field size and a strategy mix, then start a demo. It appears here with live hands, actions and players remaining."
            />
          ) : (
            <>
              {list.isStale && (
                <p className="acr-demo-stale" role="status">
                  <Icon name="warning" /> Could not refresh the list — showing the last data received.
                </p>
              )}
              <ul className="acr-demo-rows" aria-label="Demos">
                {visible.map((t) => (
                  <DemoRow key={t.id} t={t} now={now} selected={t.id === selected} canRun={canRun} onSelect={() => select(t.id === selected ? null : t.id)} />
                ))}
              </ul>
              {(filter === 'running' ? running.length : demos.length) > visible.length && (
                <div className="acr-demo-more">
                  <Button size="sm" variant="secondary" onClick={() => setShownCount((n) => n + PAGE)}>
                    Show {formatCount(Math.min(PAGE, (filter === 'running' ? running.length : demos.length) - visible.length))} more
                  </Button>
                </div>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
