import { useId, useState } from 'react';
import type { PlayerDetailDto, TournamentStatus } from '@jpb/shared-types';
import { Button, ControlCard, Icon, Panel, formatChips, formatCount } from '@jpb/ui';
import { usePermission } from '../../auth/permissions';
import { formatBB, seatText } from '../players/model';
import type { LiveSeat } from './usePlayerDetail';
import { NOTICE_MAX } from './usePlayerControls';
import type { PlayerControls } from './usePlayerControls';

const PLAYING: ReadonlySet<TournamentStatus> = new Set(['STARTING', 'RUNNING', 'BREAK', 'PAUSED', 'FINAL_TABLE']);
const OUT: ReadonlySet<PlayerDetailDto['status']> = new Set(['ELIMINATED', 'DISQUALIFIED', 'WITHDRAWN']);

export interface ControlsPanelProps {
  p: PlayerDetailDto;
  live: LiveSeat | null;
  tournamentStatus: TournamentStatus | null;
  bigBlind: number | null;
  controls: PlayerControls;
  onMove: () => void;
  onAdjust: () => void;
  onRejoinCode: () => void;
}

function Why({ children }: { children: string }) {
  return (
    <p className="acr-player-detail-why">
      <Icon name="info" /> {children}
    </p>
  );
}

/**
 * Every control of §2.8, grouped by risk. Controls the admin's role cannot
 * use are not shown (the server re-checks permission and scope anyway);
 * controls that do not apply to the player's state say why.
 */
export function ControlsPanel({ p, live, tournamentStatus, bigBlind, controls, onMove, onAdjust, onRejoinCode }: ControlsPanelProps) {
  const noticeId = useId();
  const [notice, setNotice] = useState('');
  const can = {
    move: usePermission('PLAYER_MOVE'),
    suspend: usePermission('PLAYER_SUSPEND'),
    disqualify: usePermission('PLAYER_DISQUALIFY'),
    adjust: usePermission('STACK_ADJUST'),
    announce: usePermission('ANNOUNCE'),
  };
  const playing = tournamentStatus !== null && PLAYING.has(tournamentStatus);
  const seated = (p.status === 'SEATED' || p.status === 'SUSPENDED') && p.tableId !== null;
  const stack = live?.occupant.stack ?? p.stack;
  const activeSessions = p.sessions.filter((s) => s.revokedAt === null && s.expiresAt > Date.now()).length;
  const anything = Object.values(can).some(Boolean);

  const moveWhy = !playing ? 'Players can be moved while the tournament is running.' : p.status === 'IN_TRANSIT' ? 'The player is already changing tables.' : !seated ? 'Only seated players can be moved.' : null;
  const adjustWhy = !playing ? 'Stacks can be adjusted while the tournament is running.' : !seated ? 'Only seated players have a stack to adjust.' : null;
  const suspendWhy = p.status === 'SEATED' || p.status === 'IN_TRANSIT' || p.status === 'SUSPENDED' ? null : 'Only players in play can be suspended.';
  const dqWhy =
    p.status === 'IN_TRANSIT'
      ? 'The player is changing tables; try again in a moment.'
      : ['SEATED', 'SUSPENDED', 'REGISTERED', 'PENDING_APPROVAL'].includes(p.status)
        ? null
        : 'This player is no longer in the tournament.';
  const noticeText = notice.trim();
  // Out of the tournament: seat, sit-out, chips and disqualification no longer apply.
  const out = OUT.has(p.status);

  if (!anything) {
    return (
      <Panel title="Controls" icon="sliders">
        <p className="acr-player-detail-note">
          <Icon name="lock" /> Your role can view this player but not change anything. The tournament director can move, suspend or message players.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Controls" icon="sliders" description="Every action is permission-checked by the server, confirmed here and written to the audit log with your reason." className="acr-player-detail-controls">
      {out && (
        <p className="acr-player-detail-note acr-player-detail-outnote">
          <Icon name="info" /> {p.displayName} is out of the tournament: only access and messaging apply.
        </p>
      )}
      <div className="acr-player-detail-controls__grid">
        {can.move && !out && (
          <ControlCard title="Seat" icon="move" state={p.tableId ? seatText(p.tableNumber, p.seat) : 'Not seated'} description="Move to a specific table and seat (level 1, reason required).">
            <Button size="sm" icon="move" disabled={moveWhy !== null} onClick={onMove}>
              Move to another table…
            </Button>
            {moveWhy && <Why>{moveWhy}</Why>}
          </ControlCard>
        )}

        {can.suspend && !out && (
          <ControlCard
            title="Sit out"
            icon="pause"
            tone={p.status === 'SUSPENDED' ? 'warning' : 'default'}
            state={p.status === 'SUSPENDED' ? 'Suspended — every decision is auto check / fold' : 'Playing normally'}
            description="Suspend keeps the chips and the seat; blinds are still posted."
          >
            {p.status === 'SUSPENDED' ? (
              <Button size="sm" icon="play" onClick={() => void controls.restore()}>
                Restore…
              </Button>
            ) : (
              <Button size="sm" icon="pause" variant="danger-outline" disabled={suspendWhy !== null} onClick={() => void controls.suspend()}>
                Suspend
              </Button>
            )}
            {suspendWhy && p.status !== 'SUSPENDED' && <Why>{suspendWhy}</Why>}
          </ControlCard>
        )}

        {can.adjust && !out && (
          <ControlCard title="Chips" icon="sliders" state={seated ? `${formatChips(stack)} chips · ${formatBB(stack, bigBlind)}` : 'No stack in play'} description="Correct a verified error (level 2, ADJUST).">
            <Button size="sm" icon="sliders" variant="danger-outline" disabled={adjustWhy !== null} onClick={onAdjust}>
              Adjust stack…
            </Button>
            {adjustWhy ? <Why>{adjustWhy}</Why> : live?.handInProgress ? <Why>A hand is in progress: the change applies only between hands.</Why> : null}
          </ControlCard>
        )}

        {can.suspend && (
          <ControlCard title="Access" icon="key" state={`${formatCount(activeSessions)} active session${activeSessions === 1 ? '' : 's'}`} description="Lost phone, new device or a shared code.">
            <div className="acr-player-detail-btnrow">
              <Button size="sm" icon="key" onClick={onRejoinCode}>
                New rejoin code
              </Button>
              <Button size="sm" icon="log-out" variant="danger-outline" disabled={activeSessions === 0} onClick={() => void controls.revokeSessions()}>
                Revoke all sessions…
              </Button>
            </div>
            {activeSessions === 0 && <Why>No active session to revoke.</Why>}
          </ControlCard>
        )}

        {can.announce && (
          <ControlCard title="Private notice" icon="message" description="A message only this player sees (level 1).">
            <form
              className="acr-player-detail-notice"
              onSubmit={(e) => {
                e.preventDefault();
                if (!noticeText) return;
                void controls.notice(noticeText).then((r) => {
                  if (r !== undefined) setNotice('');
                });
              }}
            >
              <label htmlFor={noticeId} className="jpb-sr-only">
                Private notice to {p.displayName}
              </label>
              <textarea
                id={noticeId}
                className="jpb-input jpb-textarea"
                rows={2}
                maxLength={NOTICE_MAX}
                value={notice}
                onChange={(e) => setNotice(e.target.value)}
                placeholder="e.g. Please return to table 12 — your hand is being dealt."
              />
              <div className="acr-player-detail-notice__foot">
                <span className="acr-player-detail-muted jpb-num" aria-live="polite">
                  {notice.length}/{NOTICE_MAX}
                </span>
                <Button size="sm" type="submit" icon="message" disabled={!noticeText}>
                  Send notice…
                </Button>
              </div>
            </form>
          </ControlCard>
        )}

        {can.disqualify && !out && (
          <ControlCard title="Disqualify" icon="ban" tone="danger" state="Permanent — cannot be undone" description="Removes the player and their chips from the tournament (level 2, DISQUALIFY).">
            <Button size="sm" icon="ban" variant="danger" disabled={dqWhy !== null} onClick={() => void controls.disqualify()}>
              Disqualify…
            </Button>
            {dqWhy && <Why>{dqWhy}</Why>}
          </ControlCard>
        )}
      </div>
    </Panel>
  );
}
