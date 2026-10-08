import { useMemo } from 'react';
import { useGameState } from '@jpb/client-sdk/react';
import type { SpectatorTableView } from '@jpb/shared-types';
import { Badge, Button, Icon, PokerTable, Spinner } from '@jpb/ui';
import { Screen } from '../../components/Screen';
import { isLive } from '../connection/connectionState';
import { eventsOfHand, handOutcome, isShowingResult, tableSeats, turnTimerMs, currentActionText } from '../table/tableModel';
import { useJpbClient } from '../usePlayerClient';

/**
 * Spectator mode after elimination: a separate SPECTATOR connection (delayed
 * by the server, public data only). Hole cards are never rendered — the
 * spectator view has none, and the table is drawn without a hero seat.
 */
export function SpectatorView({ tournamentId, wide, onBack }: { tournamentId: string; wide: boolean; onBack: () => void }) {
  const client = useJpbClient(tournamentId, 'SPECTATOR');
  const raw = useGameState(client, (s) => s.table);
  const events = useGameState(client, (s) => s.tableEvents);
  const offset = useGameState(client, (s) => s.serverOffsetMs);
  const error = useGameState(client, (s) => s.lastError);
  const connection = useGameState(client, (s) => s.connection);
  const synced = useGameState(client, (s) => s.synced);
  const view: SpectatorTableView | null = raw && raw.audience === 'SPECTATOR' ? raw : null;
  const handEvents = useMemo(() => eventsOfHand(events, view?.hand?.handId), [events, view?.hand?.handId]);
  const outcome = useMemo(() => handOutcome(view && isShowingResult(view) ? handEvents : []), [view, handEvents]);
  const seats = useMemo(() => (view ? tableSeats(view, outcome) : []), [view, outcome]);

  if (error && (error.code === 'SPECTATING_NOT_ALLOWED' || error.code === 'FORBIDDEN')) {
    return (
      <Screen eyebrow="Spectating" title="Watching is not available" lede="The organiser has turned off spectating for this tournament. You can still follow the standings." icon={<Icon name="eye" />}>
        <Button variant="secondary" onClick={onBack}>
          Back to my summary
        </Button>
      </Screen>
    );
  }
  if (!view) {
    return (
      <Screen eyebrow="Spectating" title={synced ? 'No featured table right now' : 'Joining the rail…'} lede={synced ? 'A table appears here as soon as the director features one.' : 'Connecting as a spectator.'} icon={synced ? <Icon name="eye" /> : <Spinner size="lg" />} role="status" />
    );
  }
  const live = isLive(connection, synced);
  return (
    <section className="pw-spectate" aria-label="Spectator view">
      <div className="pw-spectate__bar">
        <Badge tone="info" variant="soft">
          <Icon name="eye" /> SPECTATING
        </Badge>
        <span className="pw-spectate__where">Table {view.tableNumber}</span>
        <span className="pw-spectate__note">Slight delay · no private cards</span>
        <Button variant="ghost" size="sm" onClick={onBack} className="pw-spectate__back">
          My summary
        </Button>
      </div>
      <PokerTable
        className={live ? undefined : 'jpb-stale'}
        maxSeats={view.maxSeats}
        seats={seats}
        heroSeat={null}
        board={view.hand?.board ?? []}
        totalPot={view.hand?.totalPot ?? 0}
        actingSeat={view.hand?.actingSeat ?? null}
        actionDeadline={view.hand?.actionDeadline ?? null}
        timerMs={turnTimerMs(events, view.hand?.turnVersion, 15_000)}
        serverOffsetMs={offset}
        winningCards={outcome.winningCards}
        tableNumber={view.tableNumber}
        handNumber={view.hand?.handNumber}
        variant={wide ? 'wide' : 'auto'}
      />
      <p className="pw-spectate__now" aria-live="polite">
        {currentActionText(view, outcome)}
      </p>
    </section>
  );
}
