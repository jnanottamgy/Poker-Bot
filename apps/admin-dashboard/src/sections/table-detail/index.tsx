import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { CardCode } from '@jpb/shared-types';
import { Alert, Button, EmptyState, ErrorState, Icon, Panel, Skeleton, StatusPill, formatCount } from '@jpb/ui';
import type { MenuItem } from '@jpb/ui';
import { friendlyError } from '../../api/errors';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentState } from '../../live/useTournamentState';
import { formatTimeOfDay } from '../../lib/time';
import { formatElapsed, useNow } from '../tables/hooks';
import { DISPLAY_STATUS_META, displayStatus, holdsText, statusText } from '../tables/tableStatus';
import { ActionLog } from './ActionLog';
import { AdjustStackDialog } from './AdjustStackDialog';
import { EventLog } from './EventLog';
import { HandPanel } from './HandPanel';
import { InternalsPanel } from './InternalsPanel';
import { MessagePanel } from './MessagePanel';
import { logFromActionLog, logFromEvents, seatLabel, seatModels } from './model';
import type { LogSource, SeatModel } from './model';
import { MovePlayerDialog } from './MovePlayerDialog';
import { OvalTable } from './OvalTable';
import { RecentHands, StatsPanel } from './StatsPanel';
import { useTableControls } from './useTableControls';
import type { MoveRequest } from './useTableControls';
import { useTableDetail } from './useTableDetail';
import './table-detail.css';

function DetailSkeleton() {
  return (
    <div className="acr-page acr-td" aria-busy="true" aria-label="Loading table">
      <Skeleton width="28%" height={30} />
      <Skeleton shape="block" height={56} />
      <div className="acr-td-grid">
        <Skeleton shape="block" height={560} />
        <Skeleton shape="block" height={560} />
      </div>
    </div>
  );
}

/** §2.6 Table detail (live). */
export default function TableDetailSection() {
  const { tableId = '' } = useParams();
  return <TableDetail key={tableId} tableId={tableId} />;
}

function TableDetail({ tableId }: { tableId: string }) {
  const tournamentId = useTournamentId();
  const navigate = useNavigate();
  const t = useTournamentState(tournamentId);
  const data = useTableDetail(tournamentId, tableId);
  const { view, detail, row } = data;
  const controls = useTableControls(tournamentId, tableId, view, t.counters?.tables ?? null);
  const canControl = usePermission('TABLE_CONTROL');
  const canMove = usePermission('PLAYER_MOVE');
  const canAdjust = usePermission('STACK_ADJUST');
  const canReveal = usePermission('VIEW_HOLE_CARDS');
  const canAnnounce = usePermission('ANNOUNCE');
  const canHistory = usePermission('HAND_HISTORY_VIEW');
  const now = useNow(1000);
  const serverNow = now + data.serverOffsetMs;

  const [revealedLocal, setRevealedLocal] = useState<Record<number, [CardCode, CardCode]> | null>(null);
  const [showCards, setShowCards] = useState(false);
  const [move, setMove] = useState<{ open: boolean; init: Partial<MoveRequest> & { playerId?: string | null } }>({ open: false, init: {} });
  const [adjust, setAdjust] = useState<{ open: boolean; playerId: string | null; raw?: string }>({ open: false, playerId: null });

  const seats = useMemo(() => (view ? seatModels(view) : []), [view]);
  const players = useMemo(() => seats.filter((s): s is SeatModel => s !== null), [seats]);
  const nameOf = (seat: number) => seats[seat]?.name ?? seatLabel(seat);
  const log = useMemo(() => {
    if (!view) return { entries: [], source: 'none' as LogSource };
    if (view.handActionLog && view.handActionLog.length > 0) return { entries: logFromActionLog(view.handActionLog, nameOf), source: 'actor' as LogSource };
    const fromEvents = logFromEvents(data.events, view.hand?.handId ?? null, nameOf);
    return { entries: fromEvents, source: (fromEvents.length ? 'socket' : 'none') as LogSource };
    // nameOf derives from `seats`, which derives from `view`.
  }, [view, data.events, seats]);

  if (!view) {
    if (detail.isLoading) return <DetailSkeleton />;
    const f = friendlyError(detail.error);
    if (f.status === 404) {
      return (
        <div className="acr-page acr-td">
          <EmptyState icon="grid" title="Table not found" description="It may belong to another tournament or never existed." action={<ButtonLink to={sectionHref('tables', tournamentId)} icon="grid">Back to the table map</ButtonLink>} />
        </div>
      );
    }
    return (
      <div className="acr-page acr-td">
        <ErrorState title="Could not load this table" description={f.description} onRetry={() => void detail.refetch()} />
      </div>
    );
  }

  const statusInput = { status: row?.status ?? view.status, frozen: view.frozen, holds: view.holds };
  const status = displayStatus(statusInput);
  const detailText = statusText(statusInput);
  const meta = DISPLAY_STATUS_META[status];
  const closed = view.status === 'CLOSED';
  const finalTable = row?.isFinalTable ?? false;
  const adminHeld = view.holds.includes('ADMIN');
  const acting = view.hand?.actingSeat ?? null;
  const serverCards = view.holeCards ?? detail.data?.holeCards ?? null;
  const availableCards = serverCards ?? revealedLocal;
  const shownCards = showCards ? availableCards : null;
  const actingModel = acting !== null ? seats[acting] : null;
  const timerMs = view.turn?.timerMs ?? (actingModel?.away ? view.timing.awayActionTimerMs : view.timing.actionTimerMs);
  const internals = detail.data?.internals ?? null;
  const violations = internals?.invariantViolations ?? [];
  const sinceProgress = serverNow - (internals?.lastProgressAt ?? view.lastProgressAt);
  const stale = !data.live && detail.isStale;
  const playerHref = (playerId: string) => sectionHref('player-detail', tournamentId, { playerId });

  const openMove = (playerId: string | null) => setMove({ open: true, init: { playerId } });
  const openAdjust = (playerId: string | null) => setAdjust({ open: true, playerId });

  const seatMenu = (m: SeatModel): Array<MenuItem | 'separator'> => {
    const items: Array<MenuItem | 'separator'> = [{ id: 'open', label: 'Open player detail', icon: 'user', onSelect: () => navigate(playerHref(m.playerId)) }];
    if (closed) return items;
    if (canMove) items.push({ id: 'move', label: 'Move to another table…', icon: 'move', onSelect: () => openMove(m.playerId) });
    if (canAdjust) items.push({ id: 'adjust', label: 'Adjust stack…', icon: 'sliders', danger: true, onSelect: () => openAdjust(m.playerId) });
    if (canControl && m.acting) items.push('separator', { id: 'timeout', label: 'Force timeout…', icon: 'clock', danger: true, onSelect: () => void controls.forceTimeout() });
    return items;
  };

  const reveal = () => {
    if (availableCards) {
      setShowCards((v) => !v);
      return;
    }
    void controls.reveal((cards) => {
      setRevealedLocal(cards);
      setShowCards(true);
    });
  };

  const liveBadge: ReactNode = data.live ? (
    <StatusPill size="sm" tone="positive" live label="Live" title="Streaming from the admin WebSocket" />
  ) : stale ? (
    <StatusPill size="sm" tone="warning" icon="warning" label="Not current" title={`Last successful refresh ${formatTimeOfDay(detail.updatedAt)}`} />
  ) : (
    <StatusPill size="sm" tone="neutral" icon="refresh" label="Polling" title="The live socket is not connected; refreshing from the server every few seconds" />
  );

  const anyControl = !closed && (canControl || canMove || canAdjust);
  const revealButton =
    canReveal && !closed ? (
      <Button size="sm" variant={shownCards ? 'secondary' : 'ghost'} icon={availableCards ? 'eye' : 'lock'} aria-pressed={availableCards ? showCards : undefined} onClick={reveal} title="Hole cards are hidden by default; every reveal is audit-logged">
        {availableCards ? (showCards ? 'Hide hole cards' : 'Show hole cards') : 'Reveal live hole cards…'}
      </Button>
    ) : undefined;
  return (
    <div className="acr-page acr-td">
      <PageHeader
        title={
          <span className="acr-td-title">
            Table {view.tableNumber}
            {finalTable && (
              <span className="acr-td-finalbadge">
                <Icon name="crown" /> Final table
              </span>
            )}
          </span>
        }
        icon="grid"
        eyebrow={t.overview.data?.name}
        description={
          <span className="acr-td-statusline">
            <StatusPill size="sm" tone={meta.tone} icon={meta.icon} label={meta.label} title={meta.description} />
            {view.frozen && status !== 'FROZEN' && <StatusPill size="sm" tone="info" icon="freeze" label="Frozen" />}
            {liveBadge}
            {view.handForHand && <StatusPill size="sm" tone="warning" icon="clock" label="Hand-for-hand" />}
            <span className="acr-td-statusline__txt">
              {detailText !== meta.label ? `${detailText} · ` : ''}
              {formatCount(players.length)}/{view.maxSeats} players · {formatCount(view.handsPlayed)} hands · last progress {formatElapsed(sinceProgress)} ago
            </span>
          </span>
        }
        actions={
          <ButtonLink to={sectionHref('tables', tournamentId)} icon="grid">
            Table map
          </ButtonLink>
        }
      />

      {anyControl && (
        <section className="acr-td-controls" aria-label={`Controls for table ${view.tableNumber}`}>
          {canControl && (
            <div className="acr-td-controls__group" role="group" aria-label="Table">
              {adminHeld ? (
                <Button size="sm" icon="play" onClick={() => void controls.release()}>
                  Release hold
                </Button>
              ) : (
                <Button size="sm" icon="pause" onClick={() => void controls.hold()}>
                  Hold after hand
                </Button>
              )}
              {view.frozen ? (
                <Button size="sm" icon="play" onClick={() => void controls.unfreeze()}>
                  Unfreeze table
                </Button>
              ) : (
                <Button size="sm" variant="danger-outline" icon="freeze" onClick={() => void controls.freeze()}>
                  Freeze table
                </Button>
              )}
              <Button size="sm" icon="clock" disabled={acting === null || view.frozen} title={acting === null ? 'Nobody is acting right now' : view.frozen ? 'Unfreeze first' : undefined} onClick={() => void controls.forceTimeout()}>
                Force timeout{actingModel ? ` · ${actingModel.name}` : ''}
              </Button>
              <Button size="sm" icon="plus" disabled={acting === null || view.frozen} title={acting === null ? 'Nobody is acting right now' : view.frozen ? 'Unfreeze first' : 'Give the acting player 30 more seconds'} onClick={() => void controls.addTime()}>
                +30 s
              </Button>
            </div>
          )}
          {(canMove || canAdjust) && (
            <div className="acr-td-controls__group" role="group" aria-label="Players">
              {canMove && (
                <Button size="sm" icon="move" disabled={players.length === 0} onClick={() => openMove(null)}>
                  Move player…
                </Button>
              )}
              {canAdjust && (
                <Button size="sm" icon="sliders" disabled={players.length === 0} onClick={() => openAdjust(null)}>
                  Adjust stack…
                </Button>
              )}
            </div>
          )}
          {canControl && (
            <div className="acr-td-controls__group" role="group" aria-label="Tournament">
              <Button size="sm" icon="refresh" onClick={() => void controls.rebalance()}>
                Rebalance now
              </Button>
              <Button size="sm" variant="danger-outline" icon="split" onClick={() => void controls.breakTable()}>
                Break table…
              </Button>
            </div>
          )}
        </section>
      )}
      {!anyControl && !closed && !canReveal && (
        <p className="acr-td-viewonly">
          <Icon name="lock" /> View only — your role cannot change this table.
        </p>
      )}

      <div className="acr-td-alerts">
        {closed && <Alert severity="INFO" title="This table is closed" meta="It was broken or the tournament finished. History and the event log stay available." />}
        {status === 'STALLED' && (
          <Alert
            severity="CRITICAL"
            title={`Stalled — no progress for ${formatElapsed(sinceProgress)}`}
            meta={acting !== null ? `Waiting on ${nameOf(acting)} (${seatLabel(acting)}). Force a timeout, or freeze the table while you investigate.` : 'Nobody is acting. Check the internals below (queue, fault, owner node).'}
            actions={
              canControl && acting !== null ? (
                <Button size="sm" icon="clock" onClick={() => void controls.forceTimeout()}>
                  Force timeout…
                </Button>
              ) : undefined
            }
          />
        )}
        {internals?.faulted && <Alert severity="CRITICAL" title="The table actor is faulted" meta={`Commands are not being processed on ${internals.ownerNode ?? 'its node'}. See System for node health.`} />}
        {violations.length > 0 && <Alert severity="CRITICAL" title={`${violations.length} invariant violation${violations.length === 1 ? '' : 's'} at this table`} meta={violations[0]} />}
        {shownCards && (
          <Alert severity="WARNING" title="Live hole cards are visible to you" meta="Your reveal is recorded in the audit log. Hide them when you are done." actions={<Button size="sm" icon="eye" onClick={() => setShowCards(false)}>Hide</Button>} />
        )}
      </div>

      <div className="acr-td-grid">
        <div className="acr-td-main">
          <Panel flush className="acr-td-tablepanel" title="Live table" icon="users" actions={revealButton} description={data.live ? 'Live from the admin WebSocket (you are watching this table).' : `Refreshing from the server${detail.updatedAt ? ` — as of ${formatTimeOfDay(detail.updatedAt)}` : ''}.`}>
            <div className={stale ? 'jpb-stale' : undefined}>
              <OvalTable
                view={view}
                seats={seats}
                holeCards={shownCards}
                playerHref={playerHref}
                seatMenu={seatMenu}
                deadline={view.hand?.actionDeadline ?? null}
                timerMs={timerMs}
                serverOffsetMs={data.serverOffsetMs}
                finalTable={finalTable}
                centerNote={view.status === 'HELD' ? `Held — ${holdsText(view.holds)}` : view.status === 'BETWEEN_HANDS' ? 'Next hand is about to be dealt' : view.status === 'WAITING' ? 'Waiting for players' : null}
              />
            </div>
          </Panel>
          <div className="acr-td-row2">
            <HandPanel view={view} seats={seats} timerMs={timerMs} serverOffsetMs={data.serverOffsetMs} />
            <ActionLog entries={log.entries} source={log.source} handNumber={view.hand?.handNumber ?? null} />
          </div>
          {canHistory && <EventLog tableId={tableId} lastEventSeq={internals?.lastEventSeq ?? view.lastEventSeq} />}
        </div>
        <aside className="acr-td-side" aria-label="Table internals and history">
          <InternalsPanel internals={internals} view={view} row={row} serverNow={serverNow} fetchedAt={detail.updatedAt} />
          <StatsPanel view={view} recent={detail.data?.recentHands ?? []} />
          <RecentHands tournamentId={tournamentId} tableId={tableId} hands={detail.data?.recentHands ?? []} canOpen={canHistory} />
          {canAnnounce && !closed && <MessagePanel tableNumber={view.tableNumber} onSend={controls.message} />}
        </aside>
      </div>

      {canMove && (
        <MovePlayerDialog
          open={move.open}
          onClose={() => setMove((m) => ({ ...m, open: false }))}
          tournamentId={tournamentId}
          tableId={tableId}
          tableNumber={view.tableNumber}
          players={players}
          initial={move.init}
          onReview={(m) => {
            setMove({ open: false, init: { playerId: m.player.playerId, toTableId: m.toTableId, toTableNumber: m.toTableNumber, toSeat: m.toSeat } });
            void controls.move(m).then((r) => {
              // Cancelled or refused: reopen the form with the same choices.
              if (r === undefined) setMove((s) => ({ ...s, open: true }));
            });
          }}
        />
      )}
      {canAdjust && (
        <AdjustStackDialog
          open={adjust.open}
          onClose={() => setAdjust((a) => ({ ...a, open: false }))}
          players={players}
          initialPlayerId={adjust.playerId}
          initialValue={adjust.raw}
          bigBlind={view.blinds.bigBlind}
          handInProgress={view.hand !== null}
          onHoldFirst={
            canControl && !adminHeld
              ? () => {
                  setAdjust((a) => ({ ...a, open: false }));
                  void controls.hold();
                }
              : undefined
          }
          onReview={(a, raw) => {
            setAdjust({ open: false, playerId: a.player.playerId, raw });
            void controls.adjust(a).then((r) => {
              if (r === undefined) setAdjust((s) => ({ ...s, open: true }));
            });
          }}
        />
      )}
    </div>
  );
}
