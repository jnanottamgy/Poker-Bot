import { useCallback, useMemo, useState } from 'react';
import { Alert, ErrorState, Skeleton } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { AnnounceScope } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useLiveEvents } from '../../live/hooks';
import { useTournamentState } from '../../live/useTournamentState';
import { formatBB } from '../standings/model';
import { AnnouncementLog, CommentaryPanel } from './Activity';
import { Composer } from './Composer';
import type { Prefill, SentRecord } from './Composer';
import { DisplayControl } from './DisplayControl';
import type { AppliedDisplay } from './DisplayControl';
import type { TemplateContext } from './templates';
import './broadcast.css';

const MINUTE_MS = 60_000;
/** Announcements remembered for this session's log (the audit log keeps them all). */
const SENT_KEPT = 30;

/** §2.14 Broadcast & announcements — messages to players and control of the big screen. */
export default function BroadcastSection() {
  const tournamentId = useTournamentId();
  const state = useTournamentState(tournamentId);
  const overview = state.overview.data;
  const events = useLiveEvents();
  const canAnnounce = usePermission('ANNOUNCE');
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [sent, setSent] = useState<SentRecord[]>([]);
  const [applied, setApplied] = useState<AppliedDisplay | null>(null);
  const offset = state.offsetMs;
  const now = useCallback(() => Date.now() + offset, [offset]);

  // The champion comes from the finishing positions (1st place), only once the tournament is complete.
  const api = useApi();
  const championQ = { mode: 'finish' as const, offset: 0, limit: 1 };
  const champion = useQuery(qk.standings(tournamentId, championQ), (s) => api.standings.get(tournamentId, championQ, s), { enabled: state.status === 'COMPLETED' });
  const winner = champion.data?.rows[0]?.finishPosition === 1 ? champion.data.rows[0].displayName : null;

  const tournamentEvents = useMemo(() => events.filter((e) => e.tournamentId === tournamentId), [events, tournamentId]);

  // Everything a template may use, straight from the server's state (formatted, never computed game logic).
  const ctx = useMemo<TemplateContext>(() => {
    const bigBlind = state.currentLevel?.bigBlind ?? null;
    const breakEndsAt = state.status === 'BREAK' ? (state.clock?.breakEndsAt ?? null) : null;
    const leader = overview?.stats.chipLeader ?? null;
    return {
      tournament: overview?.name ?? null,
      level: state.currentLevel,
      nextLevel: state.nextLevel,
      remaining: state.counters?.active ?? null,
      registered: state.counters?.registered ?? null,
      tables: state.counters?.tables ?? null,
      averageStack: overview ? overview.stats.averageStack : null,
      averageBB: overview && bigBlind ? formatBB(overview.stats.averageStack, bigBlind) : null,
      leader: leader ? { name: leader.displayName, stack: leader.stack } : null,
      paidPlaces: overview?.config.prizeStructure.places.length ?? 0,
      winner,
      breakMinutes: breakEndsAt !== null ? Math.max(1, Math.ceil((breakEndsAt - now()) / MINUTE_MS)) : null,
      table: null,
      player: null,
    };
    // `now` only matters while on a break; the overview poll re-renders often enough for minutes.
  }, [state.currentLevel, state.nextLevel, state.counters, state.status, state.clock, overview, now, winner]);

  const onSent = useCallback((r: Omit<SentRecord, 'id'>) => setSent((prev) => [{ ...r, id: (prev[0]?.id ?? 0) + 1 }, ...prev].slice(0, SENT_KEPT)), []);
  const onUse = useCallback((text: string, scope: AnnounceScope) => setPrefill((p) => ({ text, scope, seq: (p?.seq ?? 0) + 1 })), []);

  const header = (
    <PageHeader
      title="Broadcast & announcements"
      icon="message"
      eyebrow={overview?.name ?? 'Tournament'}
      description="Send announcements to everyone, one table, one player or the big screen, and decide what the broadcast display shows. Every message comes from you or a fixed template — nothing is generated."
      actions={
        <>
          <ButtonLink to={sectionHref('standings', tournamentId)} icon="award">
            Standings
          </ButtonLink>
          <ButtonLink to={sectionHref('tables', tournamentId)} icon="grid">
            Tables
          </ButtonLink>
        </>
      }
    />
  );

  if (state.overview.isLoading) {
    return (
      <div className="acr-page acr-broadcast" aria-busy="true" aria-label="Loading broadcast controls">
        {header}
        <div className="acr-broadcast-layout">
          <Skeleton shape="block" height={520} />
          <Skeleton shape="block" height={520} />
        </div>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="acr-page acr-broadcast">
        {header}
        <ErrorState title="Could not load this tournament" description={friendlyError(state.overview.error).description} onRetry={() => void state.overview.refetch()} />
      </div>
    );
  }

  const status = state.status;
  const ended = status === 'COMPLETED' || status === 'CANCELLED';
  return (
    <div className="acr-page acr-broadcast">
      {header}
      {!canAnnounce && (
        <Alert severity="INFO" title="Read-only">
          Sending announcements and changing the big screen requires the ANNOUNCE permission.
        </Alert>
      )}
      {ended && (
        <Alert severity="INFO" title={status === 'COMPLETED' ? 'The tournament is complete' : 'The tournament was cancelled'}>
          Players who are still connected and the big screen keep receiving announcements.
        </Alert>
      )}
      <div className="acr-broadcast-layout">
        <div className="acr-broadcast-col">
          <Composer tournamentId={tournamentId} ctx={ctx} activePlayers={state.counters?.active ?? null} canSend={canAnnounce} prefill={prefill} onSent={onSent} now={now} />
          <CommentaryPanel events={tournamentEvents} tournamentName={overview.name} canSend={canAnnounce} onUse={onUse} />
        </div>
        <div className="acr-broadcast-col">
          <DisplayControl tournamentId={tournamentId} joinCode={overview?.joinCode ?? null} status={status} canControl={canAnnounce} ctx={ctx} applied={applied} onApplied={setApplied} now={now} />
          <AnnouncementLog tournamentId={tournamentId} sent={sent} events={tournamentEvents} />
        </div>
      </div>
    </div>
  );
}
