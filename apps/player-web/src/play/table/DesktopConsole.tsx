import type { JpbClient } from '@jpb/client-sdk';
import { useGameState } from '@jpb/client-sdk/react';
import type { PlayerTableView } from '@jpb/shared-types';
import { StackDisplay, YourTurnBanner, cx } from '@jpb/ui';
import { TableActions } from './TableActions';
import { currentActionText, eventsOfHand, handOutcome, heroTurn, isShowingResult, turnTimerMs } from './tableModel';
import { turnDetail } from './useTurnCues';

/**
 * Desktop: decision console under the wide table — your turn + timer, your
 * stack (exact on click), and the action panel.
 */
export function DesktopConsole({ client, view, live }: { client: JpbClient; view: PlayerTableView; live: boolean }) {
  const events = useGameState(client, (s) => s.tableEvents);
  const offset = useGameState(client, (s) => s.serverOffsetMs);
  const turn = heroTurn(view);
  const hero = view.seats[view.you.seat];
  const outcome = isShowingResult(view) ? handOutcome(eventsOfHand(events, view.hand?.handId)) : null;
  const now = outcome ? currentActionText(view, outcome) : currentActionText(view, { winners: new Map(), descriptions: new Map(), winningCards: [] });
  return (
    <div className={cx('pw-console', turn && 'is-turn')}>
      <div className="pw-console__status">
        {turn ? (
          <YourTurnBanner detail={turnDetail(turn.legal)} deadline={turn.deadline} serverOffsetMs={offset} timerMs={turnTimerMs(events, turn.turnVersion)} />
        ) : (
          <p className="pw-console__now" aria-live="polite">
            {now}
          </p>
        )}
        {hero && <StackDisplay amount={hero.stack} label="Your stack" size="lg" bigBlind={view.blinds.bigBlind} className="pw-console__stack" />}
      </div>
      <div className="pw-console__actions">
        <TableActions client={client} view={view} live={live} />
      </div>
    </div>
  );
}
