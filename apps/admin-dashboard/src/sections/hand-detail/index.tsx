import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { HandDetailDto, HandListItemDto, Paginated } from '@jpb/shared-types';
import { EmptyState, ErrorState, Skeleton, formatChips, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { HandsQuery } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { formatTimeOfDay } from '../../lib/time';
import { useTournamentState } from '../../live/useTournamentState';
import { useHandVerification } from '../fairness/useFairness';
import { ActionsPanel, BoardPanel, HandSummary, PotsPanel, RandomnessPanel, SeatsPanel } from './HandPanels';
import { ReplayPanel } from './ReplayPanel';
import type { CardMode } from './ReplayPanel';
import { buildReplay, replaySeatCount } from './replay';
import type { Replay } from './replay';
import { useReplayPlayer } from './useReplayPlayer';
import './hand-detail.css';

/** Previous / next hand at the same table (by hand number). */
function useNeighbour(tournamentId: string, hand: HandDetailDto | undefined, delta: -1 | 1): HandListItemDto | null {
  const api = useApi();
  const n = hand ? hand.handNumber + delta : 0;
  const q: HandsQuery = { tableId: hand?.tableId, handNumber: n, offset: 0, limit: 1 };
  const res = useQuery<Paginated<HandListItemDto>>(qk.hands(tournamentId, q), (s) => api.hands.list(tournamentId, q, s), { enabled: hand !== undefined && n >= 1, staleMs: 30_000 });
  return res.data?.rows[0] ?? null;
}

function DetailSkeleton() {
  return (
    <div className="acr-page acr-hd" aria-busy="true" aria-label="Loading the hand">
      <Skeleton shape="block" height={90} />
      <Skeleton shape="block" height={88} />
      <Skeleton shape="block" height={560} />
      <div className="acr-hd-cols">
        <Skeleton shape="block" height={320} />
        <Skeleton shape="block" height={320} />
      </div>
    </div>
  );
}

function initialFrame(replay: Replay, params: URLSearchParams): number {
  const seq = Number(params.get('seq'));
  if (Number.isInteger(seq) && replay.frameOfAction.has(seq)) return replay.frameOfAction.get(seq)!;
  if (params.get('at') === 'end') return replay.frames.length - 1;
  const step = Number(params.get('step'));
  if (Number.isInteger(step) && step >= 0 && step < replay.frames.length) return step;
  return 0;
}

function HandDetailView({ tournamentId, hand }: { tournamentId: string; hand: HandDetailDto }) {
  const [params] = useSearchParams();
  const state = useTournamentState(tournamentId);
  const canFairness = usePermission('FAIRNESS_VIEW');
  const replay = useMemo(() => buildReplay(hand), [hand]);
  const player = useReplayPlayer(replay.frames, initialFrame(replay, params));
  const [cardMode, setCardMode] = useState<CardMode>('all');
  const verification = useHandVerification(tournamentId, canFairness ? hand.handId : null);
  const prev = useNeighbour(tournamentId, hand, -1);
  const next = useNeighbour(tournamentId, hand, 1);
  const configured = state.overview.data?.config.tables.maxSize ?? null;
  const maxSeats = replaySeatCount(hand, configured);
  const frame = replay.frames[player.index];
  const verifyHref = `${sectionHref('fairness', tournamentId)}?hand=${encodeURIComponent(hand.handId)}`;

  return (
    <div className="acr-page acr-hd">
      <PageHeader
        title={`Hand #${formatCount(hand.handNumber)}`}
        icon="list"
        eyebrow={`${state.overview.data?.name ?? 'Tournament'} · Table ${hand.tableNumber}`}
        description={`${hand.players} players · pot ${formatChips(hand.totalPot)} · ${hand.completedAt ? `completed ${formatTimeOfDay(hand.completedAt)}` : 'in progress'} · hand id ${hand.handId}`}
        actions={
          <>
            <ButtonLink to={sectionHref('hands', tournamentId)} icon="list" variant="ghost">
              All hands
            </ButtonLink>
            {prev && (
              <ButtonLink to={sectionHref('hand-detail', tournamentId, { handId: prev.handId })} icon="chevron-left">
                #{formatCount(prev.handNumber)}
              </ButtonLink>
            )}
            {next && (
              <ButtonLink to={sectionHref('hand-detail', tournamentId, { handId: next.handId })} icon="chevron-right">
                #{formatCount(next.handNumber)}
              </ButtonLink>
            )}
            <ButtonLink to={sectionHref('table-detail', tournamentId, { tableId: hand.tableId })} icon="grid">
              Table {hand.tableNumber}
            </ButtonLink>
            {canFairness && (
              <ButtonLink to={verifyHref} icon="shield" variant="primary">
                Verify this hand
              </ButtonLink>
            )}
          </>
        }
      />
      <HandSummary hand={hand} />
      <ReplayPanel hand={hand} replay={replay} player={player} maxSeats={maxSeats} cardMode={cardMode} onCardMode={setCardMode} />
      <div className="acr-hd-cols">
        <div className="acr-hd-main">
          <SeatsPanel
            hand={hand}
            tournamentId={tournamentId}
            onSeatJump={(seat) => {
              const a = [...hand.actions].sort((x, y) => x.seq - y.seq).find((x) => x.seat === seat);
              if (a) player.seek(replay.frameOfAction.get(a.seq) ?? 0);
            }}
          />
          <ActionsPanel hand={hand} currentSeq={frame?.actionSeq ?? null} onJump={(seq) => player.seek(replay.frameOfAction.get(seq) ?? 0)} />
        </div>
        <div className="acr-hd-side">
          <BoardPanel hand={hand} />
          <PotsPanel hand={hand} differences={replay.differences} />
          <RandomnessPanel hand={hand} verifyHref={verifyHref} verification={canFairness ? verification : null} canVerify={canFairness} />
        </div>
      </div>
    </div>
  );
}

/** §2.10 Hand detail — full history, replay and randomness of one hand. */
export default function HandDetailSection() {
  const tournamentId = useTournamentId();
  const { handId = '' } = useParams();
  const api = useApi();
  const canView = usePermission('HAND_HISTORY_VIEW');
  const detail = useQuery(qk.hand(handId), (s) => api.hands.detail(handId, s), { enabled: canView && handId !== '', staleMs: 5 * 60_000 });

  if (!canView) {
    return (
      <div className="acr-page acr-hd">
        <PageHeader title="Hand detail" icon="list" />
        <EmptyState icon="lock" title="Hand history is restricted" description="Your role does not include HAND_HISTORY_VIEW. Ask a tournament director for access." />
      </div>
    );
  }
  if (detail.isLoading) return <DetailSkeleton />;
  if (!detail.data) {
    const f = friendlyError(detail.error);
    return (
      <div className="acr-page acr-hd">
        <PageHeader title="Hand detail" icon="list" />
        <ErrorState
          title={f.status === 404 ? 'This hand does not exist' : 'Could not load this hand'}
          description={f.status === 404 ? 'The link may be mistyped, or the hand belongs to another tournament.' : f.description}
          onRetry={f.status === 404 ? undefined : () => void detail.refetch()}
        />
        <p className="acr-hd-back">
          <ButtonLink to={sectionHref('hands', tournamentId)} icon="list">
            Back to all hands
          </ButtonLink>
        </p>
      </div>
    );
  }
  return <HandDetailView key={detail.data.handId} tournamentId={tournamentId} hand={detail.data} />;
}
