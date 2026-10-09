import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '@jpb/client-sdk';
import { Alert, Button, EmptyState, ErrorState, Skeleton, initials } from '@jpb/ui';
import { friendlyError } from '../../api/errors';
import type { RejoinCodeResponse } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentState } from '../../live/useTournamentState';
import { formatTimeOfDay } from '../../lib/time';
import { seatText } from '../players/model';
import { PlayerStatusPill } from '../players/pills';
import { ActionsPanel } from './ActionsPanel';
import { AdjustDialog } from './AdjustDialog';
import { ControlsPanel } from './ControlsPanel';
import { Hero } from './Hero';
import { IdentityPanel } from './IdentityPanel';
import { MoveDialog } from './MoveDialog';
import { MovementsPanel } from './MovementsPanel';
import { PayoutPanel } from './PayoutPanel';
import { RejoinDialog } from './RejoinDialog';
import { SessionsPanel } from './SessionsPanel';
import { TournamentPanel } from './TournamentPanel';
import { usePlayerControls } from './usePlayerControls';
import { usePlayerDetail } from './usePlayerDetail';
import './player-detail.css';

function DetailSkeleton() {
  return (
    <div className="acr-page" aria-busy="true" aria-label="Loading player">
      <Skeleton width="34%" height={34} />
      <div className="acr-skeleton-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} shape="block" height={104} />
        ))}
      </div>
      <div className="acr-player-detail-grid">
        <Skeleton shape="block" height={360} />
        <Skeleton shape="block" height={360} />
      </div>
    </div>
  );
}

/** §2.8 Player detail — everything about one player, and every per-player control. */
export default function PlayerDetailSection() {
  const tournamentId = useTournamentId();
  const { playerId = '' } = useParams();
  const state = useTournamentState(tournamentId);
  const overview = state.overview.data;
  const { query, live } = usePlayerDetail(playerId);
  const p = query.data;
  const bigBlind = state.currentLevel?.bigBlind ?? null;
  const controls = usePlayerControls(p, tournamentId, { bigBlind, counters: state.counters, liveStack: live?.occupant.stack ?? null });
  const [dialog, setDialog] = useState<'move' | 'adjust' | null>(null);
  const [issued, setIssued] = useState<RejoinCodeResponse | null>(null);
  const backLink = sectionHref('players', tournamentId);

  if (query.isLoading) return <DetailSkeleton />;
  if (!p || !controls) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return notFound ? (
      <EmptyState icon="user" title="No such player" description="The link may be wrong, or the player belongs to another tournament." action={<ButtonLink to={backLink} icon="users">All players</ButtonLink>} />
    ) : (
      <ErrorState title="Could not load this player" description={friendlyError(query.error).description} onRetry={() => void query.refetch()} />
    );
  }

  const currency = overview?.config.prizeStructure.currency ?? 'INR';
  const now = Date.now() + state.offsetMs;
  const stack = live?.occupant.stack ?? p.stack;

  return (
    <div className="acr-page acr-player-detail">
      <PageHeader
        eyebrow={
          <>
            <Link to={backLink} className="acr-player-detail-crumb">
              Players
            </Link>{' '}
            · {overview?.name ?? 'Tournament'}
          </>
        }
        title={
          <span className="acr-player-detail-title">
            <span className="acr-avatar acr-player-detail-avatar" aria-hidden="true">
              {initials(p.displayName)}
            </span>
            <span className="acr-player-detail-title__name">{p.displayName}</span>
            {p.nickname && <span className="acr-player-detail-title__nick">“{p.nickname}”</span>}
            <PlayerStatusPill status={p.status} size="md" />
          </span>
        }
        description={
          <>
            <span className="jpb-mono">{p.publicId}</span> · {seatText(p.tableNumber, p.seat)} · registered #{p.registrationSeq}
          </>
        }
        actions={
          <>
            <ButtonLink to={backLink} icon="chevron-left">
              All players
            </ButtonLink>
            {p.tableId && (
              <ButtonLink to={sectionHref('table-detail', tournamentId, { tableId: p.tableId })} icon="grid">
                Table {p.tableNumber}
              </ButtonLink>
            )}
          </>
        }
      />

      {query.isStale && (
        <Alert severity="WARNING" title="Could not refresh this player" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void query.refetch()}>Retry</Button>}>
          The figures below are greyed: last received at {formatTimeOfDay(query.updatedAt)}, not live.
        </Alert>
      )}

      <div className={query.isStale ? 'acr-player-detail-body jpb-stale' : 'acr-player-detail-body'}>
        <Hero p={p} live={live} tournamentId={tournamentId} bigBlind={bigBlind} counters={state.counters} awayAfterTimeouts={overview?.config.timing.awayAfterTimeouts ?? null} currency={currency} fetchedAt={query.updatedAt} />
        <div className="acr-player-detail-grid">
          <div className="acr-player-detail-main">
            <TournamentPanel p={p} live={live} tournamentId={tournamentId} bigBlind={bigBlind} currency={currency} />
            <MovementsPanel movements={p.movements} />
            <ActionsPanel p={p} tournamentId={tournamentId} now={now} />
            <SessionsPanel p={p} now={now} />
          </div>
          <aside className="acr-player-detail-side" aria-label="Controls and identity">
            <ControlsPanel
              p={p}
              live={live}
              tournamentStatus={state.status}
              bigBlind={bigBlind}
              controls={controls}
              onMove={() => setDialog('move')}
              onAdjust={() => setDialog('adjust')}
              onRejoinCode={() => void controls.newRejoinCode(setIssued)}
            />
            <PayoutPanel p={p} tournamentId={tournamentId} currency={currency} />
            <IdentityPanel p={p} collected={overview ? overview.config.registration.fields.map((f) => f.key) : null} />
          </aside>
        </div>
      </div>

      <MoveDialog
        open={dialog === 'move'}
        onClose={() => setDialog(null)}
        tournamentId={tournamentId}
        playerName={p.displayName}
        fromTableId={p.tableId}
        fromTableNumber={p.tableNumber}
        fromSeat={p.seat}
        maxSeats={overview?.config.tables.maxSize ?? 0}
        onReview={(t) => {
          setDialog(null);
          void controls.move(t);
        }}
      />
      <AdjustDialog
        open={dialog === 'adjust'}
        onClose={() => setDialog(null)}
        playerName={p.displayName}
        stack={stack}
        bigBlind={bigBlind}
        handInProgress={live?.handInProgress ?? false}
        onReview={(n) => {
          setDialog(null);
          void controls.adjustStack(n);
        }}
      />
      <RejoinDialog
        result={issued}
        onClose={() => setIssued(null)}
        tournamentId={tournamentId}
        tournamentName={overview?.name ?? 'Tournament'}
        joinCode={overview?.joinCode ?? ''}
        playerName={p.displayName}
        seat={p.tableNumber !== null ? seatText(p.tableNumber, p.seat) : 'Seat assigned when play starts'}
      />
    </div>
  );
}
