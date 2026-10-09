import { useEffect, useRef } from 'react';
import type { JpbClient } from '@jpb/client-sdk';
import { useGameState } from '@jpb/client-sdk/react';
import type { PlayerNotice, PlayerSelfSummary, TournamentPublicSummary } from '@jpb/shared-types';
import { Button, ChampionOverlay, EliminationCard, Icon, TableMoveCard, formatChips, useToast } from '@jpb/ui';
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
  /** Present while re-entry is offered: the elimination card's second button re-enters. */
  onReenter?: () => void;
}

/** One dedicated screen per notice kind (spec §41, §115, §116). Each must be acknowledged. */
export function NoticeView({ notice, self, tournament, currency, onDismiss, onWatch, onInfo, onReenter }: NoticeViewProps) {
  switch (notice.kind) {
    case 'TABLE_MOVE':
      // First seat at the start (or after late registration / re-entry): not a "move".
      if (notice.fromTableNumber === null) {
        return (
          <Overlay label="Your seat">
            <section className="jpb-notice jpb-move pw-notice">
              <p className="jpb-notice__eyebrow">
                <Icon name="check-circle" className="jpb-notice__eyeicon" />
                YOUR SEAT
              </p>
              <h2 className="jpb-notice__title jpb-move__title">Your seat is ready</h2>
              <div className="jpb-move__route">
                <div className="jpb-move__to">
                  <span className="jpb-move__big jpb-num">Table {notice.toTableNumber}</span>
                  <span className="jpb-move__big jpb-num">Seat {notice.toSeat + 1}</span>
                </div>
              </div>
              <p className="jpb-move__stack">
                Your stack <span className="jpb-num">{formatChips(notice.stack)}</span>
              </p>
              <Button variant="primary" size="xl" block onClick={onDismiss} iconRight="arrow-right">
                Take my seat
              </Button>
            </section>
          </Overlay>
        );
      }
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
            secondaryLabel={onReenter ? 'Re-enter the tournament' : 'Tournament standings'}
            onSecondary={() => {
              onDismiss();
              (onReenter ?? onInfo)();
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
    // MESSAGE is not a blocking screen: StaffMessages shows it in the banner area.
    default:
      return null;
  }
}

const OUT_STATUSES: ReadonlySet<string> = new Set(['ELIMINATED', 'DISQUALIFIED', 'WITHDRAWN']);

/** Notices that take over the screen (everything except staff messages and the RESTORED toast). */
export function isBlockingNotice(n: PlayerNotice): boolean {
  return n.kind !== 'MESSAGE' && n.kind !== 'RESTORED';
}

/**
 * Queued notices that newer ones made meaningless: a seat card the player
 * never acknowledged is obsolete once a later move, elimination or title
 * arrives (it would show a seat and stack they no longer have). Decided from
 * queue order only — self_update and notices travel separately, so the self
 * summary may lag behind the notice that explains it.
 */
export function supersededNotices(notices: readonly PlayerNotice[]): PlayerNotice[] {
  return notices.filter((n, i) => n.kind === 'TABLE_MOVE' && notices.slice(i + 1).some((m) => m.kind === 'TABLE_MOVE' || m.kind === 'ELIMINATED' || m.kind === 'CHAMPION'));
}

export interface NoticeLayerProps {
  client: JpbClient;
  currency: string;
  onWatch: () => void;
  onInfo: () => void;
  onReenter?: () => void;
  /**
   * The hero has a decision to make: full-screen notices wait (they stay
   * queued) so an overlay never covers the action buttons while the clock runs.
   */
  deferred?: boolean;
}

/**
 * Shows the oldest pending screen-taking notice from the server. RESTORED is
 * a toast; elimination and champion also play their (opt-in) cues. Staff
 * messages are rendered separately (StaffMessages) and never block play.
 */
export function NoticeLayer({ client, currency, onWatch, onInfo, onReenter, deferred = false }: NoticeLayerProps) {
  const notices = useGameState(client, (s) => s.notices);
  const self = useGameState(client, (s) => s.self);
  const tournament = useGameState(client, (s) => s.tournament);
  const { play, vibrate } = useSettings();
  const toast = useToast();
  const cued = useRef<PlayerNotice | null>(null);
  const restored = notices.findIndex((n) => n.kind === 'RESTORED');
  const superseded = supersededNotices(notices);
  // A seat card means nothing to a player who is out (with re-entry open the ELIMINATED notice
  // itself is deferred until positions are final): keep it queued, a later seat supersedes it.
  const out = self !== null && OUT_STATUSES.has(self.status);
  const notice = notices.find((n) => isBlockingNotice(n) && !superseded.includes(n) && !(out && n.kind === 'TABLE_MOVE')) ?? null;

  useEffect(() => {
    if (superseded.length === 0) return;
    for (const n of superseded) {
      const i = client.store.getState().notices.indexOf(n);
      if (i >= 0) client.store.dismissNotice(i);
    }
  }, [superseded, client]);

  useEffect(() => {
    if (restored < 0) return;
    toast.push({ tone: 'success', title: 'Seat restored', description: 'You are back in play. Good luck!' });
    client.store.dismissNotice(restored);
  }, [restored, client, toast]);

  useEffect(() => {
    if (!notice || deferred || cued.current === notice) return;
    cued.current = notice;
    if (notice.kind === 'ELIMINATED') {
      play('elimination');
      vibrate('elimination');
    } else if (notice.kind === 'CHAMPION') {
      play('final-table');
      vibrate('success');
    } else if (notice.kind === 'TABLE_MOVE') {
      vibrate('warning');
    }
  }, [notice, deferred, play, vibrate]);

  if (!notice || deferred) return null;
  const dismiss = () => {
    // Dismiss by identity: the queue may have changed since this notice was rendered.
    const i = client.store.getState().notices.indexOf(notice);
    if (i >= 0) client.store.dismissNotice(i);
  };
  return <NoticeView notice={notice} self={self} tournament={tournament} currency={currency} onDismiss={dismiss} onWatch={onWatch} onInfo={onInfo} onReenter={onReenter} />;
}
