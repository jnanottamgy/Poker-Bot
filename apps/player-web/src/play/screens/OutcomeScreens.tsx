import type { PlayerSelfSummary, TournamentEventEnvelope, TournamentPublicSummary } from '@jpb/shared-types';
import { Button, EliminationCard, Icon, formatMoneyMinor, formatOrdinal } from '@jpb/ui';
import { Screen } from '../../components/Screen';

export interface EliminatedScreenProps {
  self: PlayerSelfSummary;
  tournament: TournamentPublicSummary;
  currency: string;
  onWatch: () => void;
  onInfo: () => void;
  /** Present while the tournament still accepts this player's re-entry. */
  onReenter?: () => void;
}

/** After elimination (also after a reload, when the notice is gone): summary, re-entry when open, watch. */
export function EliminatedScreen({ self, tournament, currency, onWatch, onInfo, onReenter }: EliminatedScreenProps) {
  return (
    <div className="pw-center">
      {onReenter && (
        <section className="pw-reentry-cta" aria-labelledby="reentry-title">
          <p className="pw-eyebrow">Re-entry is open</p>
          <h2 id="reentry-title" className="pw-reentry-cta__title">
            Back in with a fresh stack
          </h2>
          <Button variant="primary" size="xl" block icon="refresh" onClick={onReenter}>
            Re-enter
          </Button>
        </section>
      )}
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
