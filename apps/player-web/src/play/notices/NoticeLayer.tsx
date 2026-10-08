import { useEffect, useRef } from 'react';
import type { JpbClient } from '@jpb/client-sdk';
import { useGameState } from '@jpb/client-sdk/react';
import type { PlayerNotice, PlayerSelfSummary, TournamentPublicSummary } from '@jpb/shared-types';
import { Button, ChampionOverlay, EliminationCard, Icon, TableMoveCard, useToast } from '@jpb/ui';
import { Overlay } from '../../components/Overlay';
import { useSettings } from '../../settings/SettingsContext';

export interface NoticeViewProps {
  notice: PlayerNotice;
  self: PlayerSelfSummary | null;
  tournament: TournamentPublicSummary | null;
  currency: string;
  onDismiss: () => void;
  onWatch: () => void;
  onInfo: () => void;
}

/** One dedicated screen per notice kind (spec §41, §115, §116). Each must be acknowledged. */
export function NoticeView({ notice, self, tournament, currency, onDismiss, onWatch, onInfo }: NoticeViewProps) {
  switch (notice.kind) {
    case 'TABLE_MOVE':
      return <TableMoveCard overlay fromTableNumber={notice.fromTableNumber} fromSeat={notice.fromSeat} toTableNumber={notice.toTableNumber} toSeat={notice.toSeat} stack={notice.stack} onContinue={onDismiss} />;
    case 'ELIMINATED':
      return (
        <Overlay label="You are out of the tournament">
          <EliminationCard
            finishPosition={notice.finishPosition}
            tiedCount={notice.tiedCount}
            fieldSize={tournament?.counters.registered}
            handsPlayed={notice.handsPlayed}
            prizeMinor={notice.prizeMinor}
            currency={notice.currency || currency}
            onWatch={() => {
              onDismiss();
              onWatch();
            }}
            secondaryLabel="Tournament standings"
            onSecondary={() => {
              onDismiss();
              onInfo();
            }}
          />
        </Overlay>
      );
    case 'CHAMPION':
      return (
        <ChampionOverlay
          name={self?.displayName ?? 'Champion'}
          stack={notice.stack}
          playersInField={notice.playersInField}
          prizeMinor={self?.prizeMinor ?? 0}
          currency={currency}
          tournamentName={tournament?.name}
          onClose={onDismiss}
        />
      );
    case 'SUSPENDED':
      return (
        <Overlay label="Seat suspended">
          <section className="jpb-notice pw-notice">
            <p className="jpb-notice__eyebrow">
              <Icon name="pause" /> Seat suspended
            </p>
            <h2 className="jpb-notice__title">Please see a tournament official</h2>
            <p className="pw-notice__body">{notice.reason ? `Reason: ${notice.reason}. ` : ''}Your chips are safe while your seat is on hold.</p>
            <Button variant="primary" size="xl" block onClick={onDismiss}>
              OK
            </Button>
          </section>
        </Overlay>
      );
    default:
      return null;
  }
}

/**
 * Shows the oldest pending notice from the server. RESTORED is a toast;
 * elimination and champion also play their (opt-in) cues.
 */
export function NoticeLayer({ client, currency, onWatch, onInfo }: { client: JpbClient; currency: string; onWatch: () => void; onInfo: () => void }) {
  const notices = useGameState(client, (s) => s.notices);
  const self = useGameState(client, (s) => s.self);
  const tournament = useGameState(client, (s) => s.tournament);
  const { play, vibrate } = useSettings();
  const toast = useToast();
  const cued = useRef<PlayerNotice | null>(null);
  const notice = notices[0] ?? null;

  useEffect(() => {
    if (!notice || cued.current === notice) return;
    cued.current = notice;
    if (notice.kind === 'RESTORED') {
      toast.push({ tone: 'success', title: 'Seat restored', description: 'You are back in play. Good luck!' });
      client.store.dismissNotice(0);
    } else if (notice.kind === 'ELIMINATED') {
      play('elimination');
      vibrate('elimination');
    } else if (notice.kind === 'CHAMPION') {
      play('final-table');
      vibrate('success');
    } else if (notice.kind === 'TABLE_MOVE') {
      vibrate('warning');
    }
  }, [notice, client, toast, play, vibrate]);

  if (!notice || notice.kind === 'RESTORED') return null;
  return <NoticeView notice={notice} self={self} tournament={tournament} currency={currency} onDismiss={() => client.store.dismissNotice(0)} onWatch={onWatch} onInfo={onInfo} />;
}
