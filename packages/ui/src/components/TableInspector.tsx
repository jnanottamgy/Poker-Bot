import type { ReactNode } from 'react';
import type { CardCode } from '@jpb/shared-types';
import { cx } from '../cx';
import { formatChips, formatCount } from '../format';
import { DescriptionList } from './Admin';
import { Button } from './Button';
import { Icon } from './Icon';
import { Menu } from './Menu';
import type { MenuItem } from './Menu';
import { PokerTable } from './PokerTable';
import type { TableSeat } from './PokerTable';
import { StatusPill } from './StatusPill';
import { TABLE_STATUS_META } from './TableTile';
import type { TableTileStatus } from './TableTile';

export type SeatAdminAction = 'view' | 'message' | 'move' | 'adjust-stack' | 'sit-out' | 'sit-in' | 'force-timeout' | 'eliminate';
export type TableAdminAction = 'hold' | 'release' | 'break' | 'freeze' | 'unfreeze' | 'force-timeout' | 'reveal' | 'hide' | 'history' | 'rebalance';

/** An admin's view of a seat: the public seat plus the private data the server sends to staff. */
export interface InspectorSeat extends TableSeat {
  playerId: string;
  /** Private hole cards (sent to staff only; shown only while revealed). */
  privateCards?: [CardCode, CardCode] | null;
  sittingOut?: boolean;
}

export interface TableInspectorProps {
  tableNumber: number;
  status: TableTileStatus;
  maxSeats: number;
  seats: Array<InspectorSeat | null>;
  board: CardCode[];
  totalPot: number;
  pots?: Array<{ amount: number }>;
  handNumber?: number;
  actingSeat?: number | null;
  actionDeadline?: number | null;
  timerMs?: number;
  serverOffsetMs?: number;
  frozen?: boolean;
  finalTable?: boolean;
  /** Extra detail rows (dealer, time since last hand, integrity...). */
  details?: Array<{ label: ReactNode; value: ReactNode; mono?: boolean }>;
  /** Hole cards are visible to this operator (the server decides; this only displays). */
  revealed?: boolean;
  /** Missing permission names per action; a named action is shown disabled with the reason. */
  locked?: Partial<Record<SeatAdminAction | TableAdminAction, string>>;
  onSeatAction: (seat: number, action: SeatAdminAction, playerId: string) => void;
  onTableAction: (action: TableAdminAction) => void;
  className?: string;
}

const SEAT_ACTIONS: ReadonlyArray<{ id: SeatAdminAction; label: string; icon: MenuItem['icon']; danger?: boolean }> = [
  { id: 'view', label: 'Open player', icon: 'user' },
  { id: 'message', label: 'Message player', icon: 'message' },
  { id: 'move', label: 'Move to table…', icon: 'move' },
  { id: 'adjust-stack', label: 'Adjust stack…', icon: 'sliders' },
  { id: 'sit-out', label: 'Sit out', icon: 'pause' },
  { id: 'force-timeout', label: 'Force timeout', icon: 'clock' },
  { id: 'eliminate', label: 'Eliminate…', icon: 'x-circle', danger: true },
];

/**
 * Live table view for the control room: the wide table with an admin overlay.
 * Each occupied seat has a ⋯ menu (open, message, move, adjust stack, sit
 * out / in, force timeout, eliminate); the table bar holds / releases, breaks,
 * freezes the table and reveals hole cards when the operator's role allows.
 * Destructive items only REQUEST the action: the app confirms them in a
 * ConfirmDialog and the server re-checks every permission.
 */
export function TableInspector({
  tableNumber,
  status,
  maxSeats,
  seats,
  board,
  totalPot,
  pots,
  handNumber,
  actingSeat = null,
  actionDeadline = null,
  timerMs = 0,
  serverOffsetMs = 0,
  frozen = false,
  finalTable = false,
  details,
  revealed = false,
  locked = {},
  onSeatAction,
  onTableAction,
  className,
}: TableInspectorProps) {
  const meta = TABLE_STATUS_META[status];
  const held = status === 'HELD';
  const occupied = seats.filter(Boolean) as InspectorSeat[];
  const chips = occupied.reduce((sum, s) => sum + s.stack + (s.bet ?? 0), 0);
  const tableSeats: Array<TableSeat | null> = seats.map((s) =>
    s ? { ...s, shownCards: revealed && s.privateCards ? s.privateCards : (s.shownCards ?? null), holeCards: undefined, showCardBacks: !revealed } : null,
  );
  const lockReason = (a: SeatAdminAction | TableAdminAction): string | undefined => (locked[a] ? `Requires ${locked[a]}` : undefined);

  const seatItems = (i: number, s: InspectorSeat): MenuItem[] =>
    SEAT_ACTIONS.filter((a) => !(a.id === 'force-timeout' && actingSeat !== i)).map((a) => {
      const id: SeatAdminAction = a.id === 'sit-out' && s.sittingOut ? 'sit-in' : a.id;
      return {
        id,
        label: id === 'sit-in' ? 'Sit back in' : a.label,
        icon: id === 'sit-in' ? 'play' : a.icon,
        danger: a.danger,
        disabled: Boolean(locked[id]),
        disabledReason: lockReason(id),
        onSelect: () => onSeatAction(i, id, s.playerId),
      };
    });

  return (
    <section className={cx('jpb-inspector', frozen && 'is-frozen', className)} aria-label={`Table ${tableNumber} inspector`}>
      <header className="jpb-inspector__bar">
        <div className="jpb-inspector__title">
          <h3>
            {finalTable && <Icon name="crown" className="jpb-inspector__crown" />}Table {tableNumber}
          </h3>
          <StatusPill size="sm" tone={meta.tone} icon={meta.icon} label={meta.label} />
          {frozen && <StatusPill size="sm" tone="danger" icon="freeze" label="Frozen" />}
          {handNumber !== undefined && <span className="jpb-inspector__hand jpb-num">Hand #{formatCount(handNumber)}</span>}
        </div>
        <div className="jpb-inspector__actions" role="group" aria-label={`Table ${tableNumber} controls`}>
          <Button size="sm" icon={held ? 'play' : 'pause'} disabled={Boolean(locked[held ? 'release' : 'hold'])} title={lockReason(held ? 'release' : 'hold')} onClick={() => onTableAction(held ? 'release' : 'hold')}>
            {held ? 'Release' : 'Hold after hand'}
          </Button>
          {actingSeat !== null && (
            <Button size="sm" icon="clock" disabled={Boolean(locked['force-timeout'])} title={lockReason('force-timeout')} onClick={() => onTableAction('force-timeout')}>
              Force timeout
            </Button>
          )}
          <Button size="sm" icon="split" disabled={Boolean(locked.break)} title={lockReason('break')} onClick={() => onTableAction('break')}>
            Break table…
          </Button>
          <Button
            size="sm"
            variant={revealed ? 'secondary' : 'ghost'}
            icon={revealed ? 'eye' : 'lock'}
            aria-pressed={revealed}
            disabled={Boolean(locked[revealed ? 'hide' : 'reveal'])}
            title={lockReason(revealed ? 'hide' : 'reveal') ?? 'Audited: every reveal is logged'}
            onClick={() => onTableAction(revealed ? 'hide' : 'reveal')}
          >
            {revealed ? 'Hide hole cards' : 'Reveal hole cards'}
          </Button>
          <Button size="sm" variant="danger-outline" icon="freeze" disabled={Boolean(locked[frozen ? 'unfreeze' : 'freeze'])} title={lockReason(frozen ? 'unfreeze' : 'freeze')} onClick={() => onTableAction(frozen ? 'unfreeze' : 'freeze')}>
            {frozen ? 'Unfreeze table' : 'Freeze table…'}
          </Button>
          <Menu
            label={`More for table ${tableNumber}`}
            items={[
              { id: 'history', label: 'Hand history', icon: 'list', onSelect: () => onTableAction('history') },
              { id: 'rebalance', label: 'Rebalance from this table', icon: 'refresh', disabled: Boolean(locked.rebalance), disabledReason: lockReason('rebalance'), onSelect: () => onTableAction('rebalance') },
            ]}
          />
        </div>
      </header>
      {revealed && (
        <p className="jpb-inspector__reveal" role="status">
          <Icon name="eye" /> Hole cards visible to you. This reveal is recorded in the audit log.
        </p>
      )}
      <div className="jpb-inspector__body">
        <PokerTable
          variant="wide"
          maxSeats={maxSeats}
          seats={tableSeats}
          heroSeat={null}
          board={board}
          totalPot={totalPot}
          pots={pots}
          actingSeat={actingSeat}
          actionDeadline={actionDeadline}
          timerMs={timerMs}
          serverOffsetMs={serverOffsetMs}
          tableNumber={tableNumber}
          handNumber={handNumber}
          finalTable={finalTable}
          renderSeatExtra={(i) => {
            const s = seats[i];
            return s ? <Menu label={`Actions for ${s.name}, seat ${i + 1}`} items={seatItems(i, s)} className="jpb-inspector__seatmenu" /> : null;
          }}
        />
        <DescriptionList
          columns={3}
          className="jpb-inspector__details"
          items={[
            { label: 'Players', value: `${occupied.length} / ${maxSeats}` },
            { label: 'Chips on table', value: formatChips(chips), mono: true },
            { label: 'Pot', value: formatChips(totalPot), mono: true },
            ...(details ?? []),
          ]}
        />
      </div>
    </section>
  );
}
