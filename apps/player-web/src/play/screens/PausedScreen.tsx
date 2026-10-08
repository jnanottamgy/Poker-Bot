import type { PlayerSelfSummary, TournamentPublicSummary } from '@jpb/shared-types';
import { Icon, formatChips, formatClock } from '@jpb/ui';
import { InfoTiles } from '../../components/InfoTiles';
import { Screen } from '../../components/Screen';

/** "TOURNAMENT TEMPORARILY PAUSED · Please wait." (director pause or emergency freeze). */
export function PausedScreen({ self, tournament, frozen }: { self: PlayerSelfSummary; tournament: TournamentPublicSummary; frozen: boolean }) {
  const paused = tournament.clock.pausedRemainingMs;
  return (
    <Screen
      eyebrow="Tournament temporarily paused"
      title="Please wait"
      lede={frozen ? 'The tournament director paused play. Your remaining action time is preserved — nothing happens until play resumes.' : 'Play resumes automatically. No action needed — your seat and chips are safe.'}
      icon={<Icon name="pause" />}
      tone="warning"
      role="status"
      className="pw-paused"
    >
      {paused !== null && (
        <p className="pw-chipline">
          Blind clock stopped at <strong className="jpb-num">{formatClock(paused)}</strong>
        </p>
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
