import type { ReactNode } from 'react';
import { cx } from '../cx';
import { formatChips, formatCount } from '../format';
import { DescriptionList } from './Admin';
import type { DescriptionItem } from './Admin';
import { Button } from './Button';
import type { ButtonVariant } from './Button';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Modal } from './Modal';
import { StatusPill } from './StatusPill';
import type { Tone } from './StatusPill';

export type PlayerAdminAction = 'move' | 'adjust-stack' | 'sit-out' | 'sit-in' | 'message' | 'revoke-session' | 'hand-history' | 'suspend' | 'reinstate' | 'disqualify';

export interface PlayerDrawerPlayer {
  name: string;
  publicId: string;
  status: 'SEATED' | 'IN_TRANSIT' | 'SITTING_OUT' | 'ELIMINATED' | 'SUSPENDED' | 'WAITING';
  connected: boolean;
  stack: number;
  bigBlind?: number;
  tableNumber?: number | null;
  /** 0-based seat (shown +1). */
  seat?: number | null;
  finishPosition?: number | null;
  consecutiveTimeouts?: number;
}

export interface PlayerDrawerProps {
  open: boolean;
  onClose: () => void;
  player: PlayerDrawerPlayer;
  /** Extra detail rows (registered, device, session id...). */
  details?: DescriptionItem[];
  /** Tabs / activity under the details (hands, moves, audit). */
  children?: ReactNode;
  onAction: (action: PlayerAdminAction) => void;
  /** Missing permission per action: shown disabled with "Requires X". */
  locked?: Partial<Record<PlayerAdminAction, string>>;
  inline?: boolean;
}

const STATUS: Readonly<Record<PlayerDrawerPlayer['status'], { label: string; tone: Tone; icon: IconName }>> = {
  SEATED: { label: 'Seated', tone: 'neutral', icon: 'user' },
  IN_TRANSIT: { label: 'In transit', tone: 'info', icon: 'move' },
  SITTING_OUT: { label: 'Sitting out', tone: 'warning', icon: 'pause' },
  ELIMINATED: { label: 'Eliminated', tone: 'neutral', icon: 'x-circle' },
  SUSPENDED: { label: 'Suspended', tone: 'warning', icon: 'pause' },
  WAITING: { label: 'Waiting for seat', tone: 'info', icon: 'clock' },
};

/**
 * Admin player detail drawer: exact stack (never compact here), status,
 * connection, seat, and every per-player director action grouped by risk:
 * routine (message, hand history, move), table control (sit out / in,
 * adjust stack, revoke session) and disciplinary (suspend, disqualify).
 * Actions only REQUEST; the app confirms risky ones in a ConfirmDialog.
 */
export function PlayerDrawer({ open, onClose, player, details = [], children, onAction, locked = {}, inline }: PlayerDrawerProps) {
  const st = STATUS[player.status];
  const out = player.status === 'ELIMINATED';
  const btn = (action: PlayerAdminAction, label: string, icon: IconName, variant: ButtonVariant = 'secondary', hidden = false) =>
    hidden ? null : (
      <Button key={action} size="sm" variant={variant} icon={icon} disabled={Boolean(locked[action])} title={locked[action] ? `Requires ${locked[action]}` : undefined} onClick={() => onAction(action)}>
        {label}
        {locked[action] && <span className="jpb-sr-only"> (requires {locked[action]})</span>}
      </Button>
    );
  const seatText = player.tableNumber !== null && player.tableNumber !== undefined ? `Table ${player.tableNumber}${player.seat !== null && player.seat !== undefined ? ` · Seat ${player.seat + 1}` : ''}` : '—';
  return (
    <Modal open={open} onClose={onClose} inline={inline} placement="right" title={player.name} description={`${player.publicId} · ${st.label} · ${seatText}`}>
      <div className="jpb-pdrawer">
        <div className="jpb-pdrawer__head">
          <div className="jpb-pdrawer__stack">
            <span className="jpb-pdrawer__k">Stack</span>
            <span className="jpb-pdrawer__v jpb-num">{formatChips(player.stack)}</span>
            {player.bigBlind ? <span className="jpb-pdrawer__bb jpb-num">{Math.floor((player.stack / player.bigBlind) * 10) / 10} BB</span> : null}
          </div>
          <div className="jpb-pdrawer__pills">
            <StatusPill size="sm" tone={st.tone} icon={st.icon} label={st.label} />
            {player.connected ? <StatusPill size="sm" tone="neutral" icon="wifi" label="Online" /> : <StatusPill size="sm" tone="danger" icon="wifi-off" label="Offline" />}
            {player.consecutiveTimeouts ? <StatusPill size="sm" tone="warning" icon="clock" label={`${player.consecutiveTimeouts} timeouts`} /> : null}
            {out && player.finishPosition ? <StatusPill size="sm" tone="neutral" icon="award" label={`Finished #${formatCount(player.finishPosition)}`} /> : null}
          </div>
        </div>
        <DescriptionList items={[{ label: 'Seat', value: seatText }, ...details]} />
        <section className="jpb-pdrawer__group" aria-label="Routine actions">
          <h3 className="jpb-pdrawer__h">Player</h3>
          <div className="jpb-pdrawer__btns">
            {btn('message', 'Message', 'message')}
            {btn('hand-history', 'Hand history', 'list')}
            {btn('move', 'Move…', 'move', 'secondary', out)}
          </div>
        </section>
        <section className="jpb-pdrawer__group" aria-label="Table control">
          <h3 className="jpb-pdrawer__h">Table control</h3>
          <div className="jpb-pdrawer__btns">
            {player.status === 'SITTING_OUT' ? btn('sit-in', 'Sit back in', 'play', 'secondary', out) : btn('sit-out', 'Sit out', 'pause', 'secondary', out)}
            {btn('adjust-stack', 'Adjust stack…', 'sliders', 'secondary', out)}
            {btn('revoke-session', 'Revoke session', 'log-out')}
          </div>
        </section>
        <section className="jpb-pdrawer__group is-risk" aria-label="Disciplinary actions">
          <h3 className="jpb-pdrawer__h">
            <Icon name="shield" /> Disciplinary
          </h3>
          <div className="jpb-pdrawer__btns">
            {player.status === 'SUSPENDED' ? btn('reinstate', 'Reinstate', 'play') : btn('suspend', 'Suspend…', 'pause', 'secondary', out)}
            {btn('disqualify', 'Disqualify…', 'ban', 'danger-outline', out)}
          </div>
        </section>
        {children && <div className={cx('jpb-pdrawer__more')}>{children}</div>}
      </div>
    </Modal>
  );
}
