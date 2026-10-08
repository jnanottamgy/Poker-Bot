import type { PlayerSelfSummary, TournamentPublicSummary } from '@jpb/shared-types';
import { formatChips, formatClock, useServerCountdown } from '@jpb/ui';
import { Icon } from '@jpb/ui';
import { InfoTiles } from '../../components/InfoTiles';
import { Screen } from '../../components/Screen';

/** "TOURNAMENT BREAK · NEXT LEVEL · RESUMES IN 08:42". */
export function BreakScreen({ self, tournament, serverOffsetMs, message }: { self: PlayerSelfSummary; tournament: TournamentPublicSummary; serverOffsetMs: number; message: string | null }) {
  const remaining = useServerCountdown(tournament.clock.breakEndsAt, serverOffsetMs, { intervalMs: 250 });
  const next = tournament.nextLevel;
  return (
    <Screen eyebrow="Tournament break" title="Take a breather" lede={message ?? 'Play resumes automatically. Your seat and chips are safe.'} icon={<Icon name="coffee" />} tone="info" className="pw-break">
      <div className="pw-countdown is-large" role="timer" aria-label={`Resumes in ${formatClock(remaining)}`}>
        <span className="pw-countdown__label">Resumes in</span>
        <span className="pw-countdown__value jpb-num" aria-hidden="true">
          {formatClock(remaining)}
        </span>
      </div>
      {next && (
        <div className="pw-nextlevel">
          <span className="pw-nextlevel__label">Next level {next.level}</span>
          <span className="pw-nextlevel__value jpb-num">
            {formatChips(next.smallBlind)} / {formatChips(next.bigBlind)}
            {next.ante > 0 && <span className="pw-nextlevel__ante"> ante {formatChips(next.ante)}</span>}
          </span>
        </div>
      )}
      <InfoTiles
        tiles={[
          { label: 'Your stack', value: formatChips(self.stack), emphasis: true },
          { label: 'Table', value: self.tableNumber ?? '—' },
          { label: 'Seat', value: self.seat !== null ? self.seat + 1 : '—' },
        ]}
      />
    </Screen>
  );
}
