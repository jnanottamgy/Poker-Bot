import { useState } from 'react';
import type { Paginated, PlayerListItemDto } from '@jpb/shared-types';
import { Alert, Button, ErrorState, Skeleton } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { PlayersQuery } from '../../api/types';
import { useTournamentId } from '../../auth/scope';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentState } from '../../live/useTournamentState';
import { formatTimeOfDay } from '../../lib/time';
import { useCopy } from '../players/clipboard';
import { PrintPortal, usePrint } from '../players/print';
import { joinUrlFor, useJoinQr } from '../players/qr';
import { LifecyclePanel } from './LifecyclePanel';
import { ManualRegistration } from './ManualRegistration';
import { PendingQueue } from './PendingQueue';
import { Poster } from './Poster';
import { ProjectorView } from './ProjectorView';
import { QrPanel } from './QrPanel';
import { RegisteredList } from './RegisteredList';
import { RulesPanel } from './RulesPanel';
import { StatusHero } from './StatusHero';
import { registrationState } from './model';
import './registration.css';

const PENDING_ID = 'acr-registration-pending';
const PENDING_POLL_MS = 8_000;

function RegistrationSkeleton() {
  return (
    <div className="acr-page" aria-busy="true" aria-label="Loading registration">
      <Skeleton width="30%" height={30} />
      <Skeleton shape="block" height={150} />
      <div className="acr-registration-grid">
        <Skeleton shape="block" height={420} />
        <Skeleton shape="block" height={420} />
      </div>
    </div>
  );
}

/** §2.9 Registration — open / close, QR, approvals, manual registration and the start. */
export default function RegistrationSection() {
  const tournamentId = useTournamentId();
  const api = useApi();
  const copy = useCopy();
  const state = useTournamentState(tournamentId);
  const overview = state.overview;
  const qr = useJoinQr(tournamentId);
  const poster = usePrint();
  const [projector, setProjector] = useState(false);
  const pendingQ: PlayersQuery = { status: 'PENDING_APPROVAL', offset: 0, limit: 1 };
  const pendingTotal = useQuery<Paginated<PlayerListItemDto>>(qk.players(tournamentId, pendingQ), (s) => api.players.list(tournamentId, pendingQ, s), { pollMs: PENDING_POLL_MS });

  if (overview.isLoading) return <RegistrationSkeleton />;
  if (!overview.data) {
    return <ErrorState title="Could not load this tournament" description={friendlyError(overview.error).description} onRetry={() => void overview.refetch()} />;
  }
  const o = overview.data;
  const cfg = o.config;
  const joinUrl = joinUrlFor(o.joinCode);
  const reg = registrationState(state.status, cfg, state.currentLevel);
  const accepting = reg.key === 'open' || reg.key === 'late';
  const registered = state.counters?.registered ?? o.counters.registered;
  const pending = pendingTotal.data?.total ?? null;
  const now = Date.now() + state.offsetMs;
  const showPending = () => {
    const el = document.getElementById(PENDING_ID);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.focus({ preventScroll: true });
  };

  return (
    <div className="acr-page acr-registration">
      <PageHeader
        title="Registration"
        icon="user"
        eyebrow={o.name}
        description="Open and close registration, share the QR code, approve players, register players at the desk and start the tournament."
        actions={
          <>
            <Button size="sm" variant="secondary" icon="arrow-right" onClick={() => void copy(joinUrl, 'Join link')}>
              Copy join link
            </Button>
            <Button size="sm" variant="secondary" icon="file" onClick={poster.print}>
              Print poster
            </Button>
            <Button size="sm" variant="primary" icon="monitor" onClick={() => setProjector(true)}>
              Projector view
            </Button>
          </>
        }
      />

      {overview.isStale && (
        <Alert severity="WARNING" title="Could not refresh the tournament" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void overview.refetch()}>Retry</Button>}>
          Figures are greyed: last received at {formatTimeOfDay(overview.updatedAt)}, not live.
        </Alert>
      )}

      <div className={overview.isStale ? 'acr-registration-body jpb-stale' : 'acr-registration-body'}>
        <StatusHero status={state.status} config={cfg} counters={state.counters ?? o.counters} level={state.currentLevel} pending={pending} onShowPending={showPending} />

        <div className="acr-registration-grid">
          <div className="acr-registration-main">
            <div id={PENDING_ID} tabIndex={-1} className="acr-registration-anchor">
              <PendingQueue tournamentId={tournamentId} requireApproval={cfg.registration.requireApproval} now={now} />
            </div>
            <RegisteredList tournamentId={tournamentId} />
          </div>
          <aside className="acr-registration-side" aria-label="Registration controls">
            <LifecyclePanel overview={o} status={state.status} registered={registered} pending={pending} />
            <QrPanel joinUrl={joinUrl} joinCode={o.joinCode} accessCode={cfg.registration.accessCode} qr={qr} onProjector={() => setProjector(true)} onPoster={poster.print} />
            <ManualRegistration tournamentId={tournamentId} tournamentName={o.name} joinCode={o.joinCode} config={cfg} accepting={accepting} qr={qr} />
            <RulesPanel config={cfg} />
          </aside>
        </div>
      </div>

      <ProjectorView
        open={projector}
        onClose={() => setProjector(false)}
        tournamentName={o.name}
        joinUrl={joinUrl}
        accessCode={cfg.registration.accessCode}
        qrSrc={qr.src}
        registered={registered}
        maxPlayers={cfg.maxPlayers}
        registrationOpen={accepting}
      />
      {poster.printing && (
        <PrintPortal onDone={poster.done}>
          <Poster tournamentName={o.name} joinUrl={joinUrl} accessCode={cfg.registration.accessCode} qrSrc={qr.src} startTime={cfg.startTime} startingStack={cfg.startingStack} requireApproval={cfg.registration.requireApproval} />
        </PrintPortal>
      )}
    </div>
  );
}
