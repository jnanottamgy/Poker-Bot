import { ErrorState, Skeleton } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentControls } from '../../danger/useTournamentControls';
import { useTournamentState } from '../../live/useTournamentState';
import { ChartsPanel } from './ChartsPanel';
import { ChipConservationPanel } from './ChipConservationPanel';
import { FsmPanel } from './FsmPanel';
import { KpiGrid } from './KpiGrid';
import { LiveFeedPanel } from './LiveFeedPanel';
import { OpenAlertsPanel } from './OpenAlertsPanel';

const METRICS_POLL_MS = 15_000;
const SYSTEM_POLL_MS = 20_000;

function OverviewSkeleton() {
  return (
    <div className="acr-page" aria-busy="true" aria-label="Loading overview">
      <Skeleton shape="block" height={150} />
      <div className="acr-skeleton-grid">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} shape="block" height={112} />
        ))}
      </div>
    </div>
  );
}

/** §2.3 Overview — tournament health at a glance. */
export default function OverviewSection() {
  const tournamentId = useTournamentId();
  const api = useApi();
  const state = useTournamentState(tournamentId);
  const controls = useTournamentControls(tournamentId, state);
  const canMetrics = usePermission('METRICS_VIEW');
  const metrics = useQuery(qk.metrics(tournamentId), (s) => api.system.liveMetrics(tournamentId, s), { enabled: canMetrics, pollMs: METRICS_POLL_MS });
  const system = useQuery(qk.system(), (s) => api.system.get(s), { enabled: canMetrics, pollMs: SYSTEM_POLL_MS });
  const overview = state.overview;

  if (overview.isLoading) return <OverviewSkeleton />;
  if (!overview.data) {
    return <ErrorState title="Could not load this tournament" description={friendlyError(overview.error).description} onRetry={() => void overview.refetch()} />;
  }
  const o = overview.data;
  const now = overview.updatedAt || 0;
  return (
    <div className="acr-page acr-overview">
      <PageHeader
        title="Overview"
        icon="activity"
        eyebrow={o.name}
        description="Tournament health at a glance. Figures update live; the server is the source of truth."
        actions={
          <>
            <ButtonLink to={sectionHref('clock', tournamentId)} icon="clock">
              Clock & structure
            </ButtonLink>
            <ButtonLink to={sectionHref('tables', tournamentId)} icon="grid">
              Table map
            </ButtonLink>
          </>
        }
      />
      <FsmPanel overview={o} controls={controls} />
      <KpiGrid overview={o} state={state} points={metrics.data?.points} />
      <div className="acr-overview__grid">
        <div className="acr-overview__main">
          {canMetrics ? <ChartsPanel points={metrics.data?.points} system={system.data} loading={metrics.isLoading} /> : null}
          <LiveFeedPanel tournamentId={tournamentId} />
        </div>
        <aside className="acr-overview__side" aria-label="Integrity">
          <ChipConservationPanel tournamentId={tournamentId} cc={o.chipConservation} fetchedAt={now} />
          <OpenAlertsPanel tournamentId={tournamentId} now={now} />
        </aside>
      </div>
    </div>
  );
}
