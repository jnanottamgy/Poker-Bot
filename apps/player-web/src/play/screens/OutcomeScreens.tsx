import type { PlayerSelfSummary, TournamentEventEnvelope, TournamentPublicSummary } from '@jpb/shared-types';
import { Button, EliminationCard, Icon, formatMoneyMinor, formatOrdinal } from '@jpb/ui';
import { Screen } from '../../components/Screen';

/** After elimination (also after a reload, when the notice is gone): summary + watch. */
export function EliminatedScreen({ self, tournament, currency, onWatch, onInfo }: { self: PlayerSelfSummary; tournament: TournamentPublicSummary; currency: string; onWatch: () => void; onInfo: () => void }) {
  return (
    <div className="pw-center">
      <EliminationCard
        finishPosition={self.finishPosition ?? tournament.counters.active + 1}
        fieldSize={tournament.counters.registered}
        handsPlayed={self.handsPlayed}
        prizeMinor={self.prizeMinor}
        currency={currency}
        onWatch={onWatch}
        secondaryLabel="Tournament standings"
        onSecondary={onInfo}
      />
    </div>
  );
}

export function CompletedScreen({ self, events, currency, onInfo }: { self: PlayerSelfSummary; events: readonly TournamentEventEnvelope[]; currency: string; onInfo: () => void }) {
  const done = [...events].reverse().find((e) => e.event.kind === 'TOURNAMENT_COMPLETED');
  const winner = done && done.event.kind === 'TOURNAMENT_COMPLETED' ? done.event.winnerName : null;
  const champion = self.finishPosition === 1;
  return (
    <Screen
      eyebrow="Tournament complete"
      title={champion ? 'You won the tournament' : winner ? `${winner} wins` : 'Thanks for playing'}
      lede={self.finishPosition !== null ? `You finished ${formatOrdinal(self.finishPosition)}.` : 'Final standings are now available.'}
      icon={<Icon name="trophy" />}
      tone="gold"
      actions={
        <Button variant={champion ? 'gold' : 'primary'} size="lg" block onClick={onInfo}>
          Final standings
        </Button>
      }
    >
      {self.prizeMinor > 0 && <p className="pw-chipline is-gold">Prize {formatMoneyMinor(self.prizeMinor, currency)} · see the prize desk</p>}
    </Screen>
  );
}
