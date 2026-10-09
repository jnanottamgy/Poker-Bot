import type { PlayerSelfSummary, TournamentPublicSummary } from '@jpb/shared-types';
import { Button, formatChips, formatClock, formatCount, useServerCountdown } from '@jpb/ui';
import { InfoTiles } from '../../components/InfoTiles';
import type { InfoTile } from '../../components/InfoTiles';
import { Screen } from '../../components/Screen';

export interface LobbyScreenProps {
  self: PlayerSelfSummary;
  tournament: TournamentPublicSummary;
  serverOffsetMs: number;
  /** Scheduled start from the join info (fallback when the clock has no start yet). */
  startTime: number | null;
  /** Configured starting stack (join info): chips are only assigned when the player is seated. */
  startingStack: number | null;
  onSettings: () => void;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "WELCOME · TABLE 47 · SEAT 6 · STARTING STACK 10,000 · TOURNAMENT STARTING 00:27". */
export function LobbyScreen({ self, tournament, serverOffsetMs, startTime, startingStack, onSettings }: LobbyScreenProps) {
  const starting = tournament.status === 'STARTING';
  const target = tournament.clock.levelStartedAt ?? startTime;
  const remaining = useServerCountdown(target, serverOffsetMs, { intervalMs: 250 });
  const seated = self.tableNumber !== null && self.seat !== null;
  // The server keeps stack 0 until the seat is assigned; show the configured starting stack meanwhile.
  const stack = self.stack > 0 ? self.stack : (startingStack ?? self.stack);
  const tiles: InfoTile[] = seated
    ? [
        { label: 'Table', value: self.tableNumber },
        { label: 'Seat', value: (self.seat ?? 0) + 1 },
        { label: 'Starting stack', value: formatChips(stack), emphasis: true },
      ]
    : [
        { label: 'Player ID', value: <span className="jpb-mono">{self.publicId}</span> },
        { label: 'Starting stack', value: formatChips(stack), emphasis: true },
      ];
  const countdownLabel = starting ? 'Tournament starting' : 'Starts in';

  return (
    <Screen eyebrow="Welcome" title={`Welcome, ${firstName(self.displayName)}`} lede={seated ? 'Your seat is ready. Cards are dealt automatically when the clock starts.' : 'You are registered. Seats are announced when the tournament starts.'} className="pw-lobby">
      <InfoTiles tiles={tiles} />
      <div className="pw-countdown" role="timer" aria-label={target ? `${countdownLabel} in ${formatClock(remaining)}` : 'Starting soon'}>
        <span className="pw-countdown__label">{target ? countdownLabel : 'Starting soon'}</span>
        <span className="pw-countdown__value jpb-num" aria-hidden="true">
          {target ? formatClock(remaining) : '--:--'}
        </span>
      </div>
      <p className="pw-lobby__meta">
        <span className="jpb-num">{formatCount(tournament.counters.registered)}</span> {tournament.counters.registered === 1 ? 'player' : 'players'} registered · Player ID{' '}
        <span className="jpb-mono">{self.publicId}</span>
      </p>
      <ul className="pw-tips">
        <li>Keep this page open — it updates live.</li>
        <li>Lost connection? Just reopen this page. Your seat and chips are safe on the server.</li>
      </ul>
      <Button variant="secondary" icon="bell" onClick={onSettings}>
        Turn on sound &amp; vibration
      </Button>
    </Screen>
  );
}
