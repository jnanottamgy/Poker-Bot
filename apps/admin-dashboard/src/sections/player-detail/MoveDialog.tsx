import { useEffect, useId, useState } from 'react';
import type { Paginated, TableListItemDto } from '@jpb/shared-types';
import { Button, EmptyState, ErrorState, Icon, Modal, SearchInput, Skeleton, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { seatText } from '../players/model';
import type { MoveTarget } from './usePlayerControls';

/** Destination tables listed per lookup (server-side search by number; never all tables). */
export const DESTINATION_LIMIT = 30;
const MAX_TABLE_DIGITS = 7;

const TABLE_STATUS_TEXT: Readonly<Record<TableListItemDto['status'], string>> = {
  WAITING: 'Waiting',
  BETWEEN_HANDS: 'Between hands',
  IN_HAND: 'In hand',
  HELD: 'Held',
  CLOSED: 'Closed',
  STALLED: 'Stalled',
};

function SeatPicker({ tableId, value, onChange }: { tableId: string; value: number | null; onChange: (s: number | null) => void }) {
  const api = useApi();
  const name = useId();
  const detail = useQuery(qk.table(tableId), (s) => api.tables.detail(tableId, s));
  const view = detail.data?.view;
  return (
    <fieldset className="acr-player-detail-move__seats">
      <legend className="acr-player-detail-move__legend">Seat (optional)</legend>
      <label className={cx('acr-player-detail-move__auto', value === null && 'is-on')}>
        <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} />
        <span>
          <strong>Best seat — automatic (recommended)</strong>
          <span className="acr-player-detail-move__hint">Johnny scores every free seat for blind fairness (position, blinds owed, recent moves) and picks the best one. The score is kept in the movement history.</span>
        </span>
      </label>
      {detail.isLoading ? (
        <Skeleton width="60%" />
      ) : view ? (
        <div className="acr-player-detail-move__seatgrid" role="group" aria-label="Or choose a free seat">
          {Array.from({ length: view.maxSeats }, (_, i) => {
            const occupant = view.seats[i] ?? null;
            return (
              <label key={i} className={cx('acr-player-detail-move__seat', occupant && 'is-taken', value === i && 'is-on')} title={occupant ? `Seat ${i + 1}: ${occupant.displayName}` : `Seat ${i + 1}: free`}>
                <input type="radio" name={name} disabled={occupant !== null} checked={value === i} onChange={() => onChange(i)} />
                <span className="jpb-num">{i + 1}</span>
                <span className="acr-player-detail-move__seatstate">{occupant ? 'taken' : 'free'}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="acr-player-detail-muted">Could not load the seats of this table; the automatic seat still works.</p>
      )}
    </fieldset>
  );
}

export interface MoveDialogProps {
  open: boolean;
  onClose: () => void;
  tournamentId: string;
  playerName: string;
  fromTableId: string | null;
  fromTableNumber: number | null;
  fromSeat: number | null;
  /** config.tables.maxSize: lists only tables with a free seat. */
  maxSeats: number;
  onReview: (t: MoveTarget) => void;
}

/**
 * Pick the destination of an admin move: a table (server search by number,
 * open tables only) and optionally a free seat. "Review move" hands over to
 * the level-1 confirmation, which asks for the mandatory reason.
 */
export function MoveDialog({ open, onClose, tournamentId, playerName, fromTableId, fromTableNumber, fromSeat, maxSeats, onReview }: MoveDialogProps) {
  const api = useApi();
  const group = useId();
  const [search, setSearch] = useState('');
  const [dest, setDest] = useState<{ id: string; number: number } | null>(null);
  const [seat, setSeat] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setDest(null);
    setSeat(null);
  }, [open]);

  // Only tables with a free seat (server filter), by number; closed tables and the current one are not destinations.
  const q = { ...(search ? { q: search } : {}), ...(maxSeats > 0 ? { maxPlayers: maxSeats - 1 } : {}), sort: 'number' as const, offset: 0, limit: DESTINATION_LIMIT };
  const tables = useQuery<Paginated<TableListItemDto>>(qk.tables(tournamentId, q), (s) => api.tables.list(tournamentId, q, s), { enabled: open });
  const rows = (tables.data?.rows ?? []).filter((r) => r.tableId !== fromTableId && r.status !== 'CLOSED');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Move ${playerName}`}
      description={`Now at ${seatText(fromTableNumber, fromSeat).toLowerCase()}. The move happens after the current hand; every move is audit-logged.`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="move" disabled={dest === null} onClick={() => dest && onReview({ toTableId: dest.id, toTableNumber: dest.number, toSeat: seat })}>
            Review move…
          </Button>
        </>
      }
    >
      <div className="acr-player-detail-move">
        <fieldset className="acr-player-detail-move__tables">
          <legend className="acr-player-detail-move__legend">Destination table</legend>
          <SearchInput
            value={search}
            onChange={(v) => setSearch(v.replace(/[^0-9]/g, '').slice(0, MAX_TABLE_DIGITS))}
            label="Find a table by number"
            placeholder="Table number…"
            inputMode="numeric"
            resultSummary={`${rows.length} tables`}
          />
          {tables.isLoading ? (
            <Skeleton lines={4} />
          ) : tables.data === undefined ? (
            <ErrorState title="Could not load tables" description={friendlyError(tables.error).description} onRetry={() => void tables.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState compact icon="grid" title="No table with a free seat matches" description="Try another table number, or rebalance from the table map." />
          ) : (
            <div className="acr-player-detail-move__list" role="radiogroup" aria-label="Destination table">
              {rows.map((r) => {
                const full = r.players >= r.maxSeats;
                return (
                  <label key={r.tableId} className={cx('acr-player-detail-move__table', dest?.id === r.tableId && 'is-on', full && 'is-full')}>
                    <input
                      type="radio"
                      name={group}
                      disabled={full}
                      checked={dest?.id === r.tableId}
                      onChange={() => {
                        setDest({ id: r.tableId, number: r.tableNumber });
                        setSeat(null);
                      }}
                    />
                    <span className="acr-player-detail-move__tno jpb-num">T{r.tableNumber}</span>
                    <span className="acr-player-detail-move__fill" aria-hidden="true">
                      <span style={{ width: `${Math.round((r.players / Math.max(1, r.maxSeats)) * 100)}%` }} />
                    </span>
                    <span className="jpb-num acr-player-detail-move__count">
                      {formatCount(r.players)}/{r.maxSeats}
                    </span>
                    <span className="acr-player-detail-move__tstatus">{full ? 'Full' : TABLE_STATUS_TEXT[r.status]}</span>
                    {r.isFinalTable && <span className="acr-player-detail-move__final">Final</span>}
                  </label>
                );
              })}
            </div>
          )}
          {tables.data && tables.data.total > DESTINATION_LIMIT && (
            <p className="acr-player-detail-move__hint">
              Showing {DESTINATION_LIMIT} of {formatCount(tables.data.total)} tables with a free seat — type a number to find another.
            </p>
          )}
        </fieldset>

        {dest && <SeatPicker key={dest.id} tableId={dest.id} value={seat} onChange={setSeat} />}

        {dest && (
          <p className="acr-player-detail-move__summary" role="status">
            <Icon name="move" /> {seatText(fromTableNumber, fromSeat)} → table {dest.number}, {seat === null ? 'best seat (automatic)' : `seat ${seat + 1}`}
          </p>
        )}
      </div>
    </Modal>
  );
}
