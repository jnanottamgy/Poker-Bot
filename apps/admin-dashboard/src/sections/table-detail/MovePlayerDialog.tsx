import { useEffect, useId, useState } from 'react';
import type { Paginated, TableListItemDto } from '@jpb/shared-types';
import { Button, EmptyState, Icon, Modal, SearchInput, Skeleton, cx, formatChips } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { DISPLAY_STATUS_META, displayStatus, rowStatusInput } from '../tables/tableStatus';
import { seatLabel } from './model';
import type { SeatModel } from './model';
import type { MoveRequest } from './useTableControls';

/** Destination tables listed per search (server-side by table number prefix). */
export const DESTINATION_LIMIT = 40;

export interface MovePlayerDialogProps {
  open: boolean;
  onClose: () => void;
  tournamentId: string;
  tableId: string;
  tableNumber: number;
  players: SeatModel[];
  initial: Partial<Pick<MoveRequest, 'toTableId' | 'toTableNumber' | 'toSeat'>> & { playerId?: string | null };
  onReview: (m: MoveRequest) => void;
}

function FreeSeats({ tableId, value, onChange }: { tableId: string; value: number | null; onChange: (s: number | null) => void }) {
  const api = useApi();
  const dest = useQuery(qk.table(tableId), (s) => api.tables.detail(tableId, s));
  const view = dest.data?.view;
  const name = useId();
  return (
    <fieldset className="acr-td-move__seats">
      <legend className="acr-td-move__legend">Destination seat</legend>
      <label className={cx('acr-td-move__opt', value === null && 'is-on')}>
        <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} />
        <span>
          <strong>Automatic (recommended)</strong>
          <span className="acr-td-move__hint">Johnny scores every free seat by blind fairness (position, blinds owed, recent moves) and picks the best one.</span>
        </span>
      </label>
      {dest.isLoading ? (
        <Skeleton width="60%" />
      ) : view ? (
        <div className="acr-td-move__seatgrid" role="group" aria-label="Or choose a free seat">
          {Array.from({ length: view.maxSeats }, (_, i) => {
            const taken = view.seats[i] !== null && view.seats[i] !== undefined;
            return (
              <label key={i} className={cx('acr-td-move__seat', taken && 'is-taken', value === i && 'is-on')} title={taken ? `${seatLabel(i)} taken by ${view.seats[i]?.displayName}` : `${seatLabel(i)} free`}>
                <input
                  type="radio"
                  name={name}
                  disabled={taken}
                  checked={value === i}
                  onChange={() => onChange(i)}
                  aria-label={taken ? `${seatLabel(i)}, taken by ${view.seats[i]?.displayName ?? 'a player'}` : `${seatLabel(i)}, free`}
                />
                <span className="jpb-num" aria-hidden="true">
                  {i + 1}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="acr-td-muted">Could not load the destination seats; automatic seating still works.</p>
      )}
    </fieldset>
  );
}

/**
 * Move a player from this table: choose the player, the destination table
 * (server search by number) and a seat (or let the seat-fairness formula
 * choose). "Review move" hands over to the level-1 confirmation (reason).
 */
export function MovePlayerDialog({ open, onClose, tournamentId, tableId, tableNumber, players, initial, onReview }: MovePlayerDialogProps) {
  const api = useApi();
  const playerSel = useId();
  const destName = useId();
  const [playerId, setPlayerId] = useState<string>(initial.playerId ?? players[0]?.playerId ?? '');
  const [search, setSearch] = useState('');
  const [dest, setDest] = useState<{ id: string; number: number } | null>(initial.toTableId && initial.toTableNumber !== undefined ? { id: initial.toTableId, number: initial.toTableNumber } : null);
  const [seat, setSeat] = useState<number | null>(initial.toSeat ?? null);

  useEffect(() => {
    if (!open) return;
    setPlayerId(initial.playerId ?? players[0]?.playerId ?? '');
    setDest(initial.toTableId && initial.toTableNumber !== undefined ? { id: initial.toTableId, number: initial.toTableNumber } : null);
    setSeat(initial.toSeat ?? null);
    setSearch('');
    // Only when the dialog opens: later prop changes (live seats) must not reset the form.
  }, [open]);

  const q = { ...(search ? { q: search } : {}), sort: 'number' as const, offset: 0, limit: DESTINATION_LIMIT };
  const tables = useQuery<Paginated<TableListItemDto>>(qk.tables(tournamentId, q), (s) => api.tables.list(tournamentId, q, s), { enabled: open });
  const rows = (tables.data?.rows ?? []).filter((r) => r.tableId !== tableId && r.status !== 'CLOSED');
  const player = players.find((p) => p.playerId === playerId) ?? null;
  const canReview = player !== null && dest !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Move a player"
      description="The move is applied when the player’s current hand ends. Every move is audit-logged."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="move" disabled={!canReview} onClick={() => player && dest && onReview({ player, toTableId: dest.id, toTableNumber: dest.number, toSeat: seat })}>
            Review move…
          </Button>
        </>
      }
    >
      <div className="acr-td-move">
        <div className="jpb-field">
          <label htmlFor={playerSel} className="jpb-field__label">
            Player
          </label>
          <span className="jpb-select-wrap">
            <select id={playerSel} className="jpb-input jpb-select" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
              {players.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {`${seatLabel(p.seat)} · ${p.name} · ${formatChips(p.stack)} chips`}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" className="jpb-select__chevron" />
          </span>
        </div>

        <fieldset className="acr-td-move__tables">
          <legend className="acr-td-move__legend">Destination table</legend>
          <SearchInput value={search} onChange={(v) => setSearch(v.replace(/[^0-9]/g, '').slice(0, 7))} label="Find a table by number" placeholder="Table number…" inputMode="numeric" resultSummary={`${rows.length} tables`} />
          {tables.isLoading ? (
            <Skeleton lines={4} />
          ) : rows.length === 0 ? (
            <EmptyState compact icon="grid" title="No open table matches" description="Try another number." />
          ) : (
            <div className="acr-td-move__list" role="radiogroup" aria-label="Destination table">
              {rows.map((r) => {
                const full = r.players >= r.maxSeats;
                const s = displayStatus(rowStatusInput(r));
                return (
                  <label key={r.tableId} className={cx('acr-td-move__table', dest?.id === r.tableId && 'is-on', full && 'is-full')}>
                    <input
                      type="radio"
                      name={destName}
                      disabled={full}
                      aria-label={`Table ${r.tableNumber}, ${r.players} of ${r.maxSeats} players, ${full ? 'full' : DISPLAY_STATUS_META[s].label.toLowerCase()}`}
                      checked={dest?.id === r.tableId}
                      onChange={() => {
                        setDest({ id: r.tableId, number: r.tableNumber });
                        setSeat(null);
                      }}
                    />
                    <span className="acr-td-move__tno jpb-num" aria-hidden="true">
                      T{r.tableNumber}
                    </span>
                    <span className="jpb-num" aria-hidden="true">
                      {r.players}/{r.maxSeats}
                    </span>
                    <span className="acr-td-move__tstatus" aria-hidden="true">
                      {full ? 'Full' : DISPLAY_STATUS_META[s].label}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {tables.data && tables.data.total > DESTINATION_LIMIT && <p className="acr-td-move__hint">Showing {DESTINATION_LIMIT} of {tables.data.total} tables — type a number to narrow.</p>}
        </fieldset>

        {dest && <FreeSeats key={dest.id} tableId={dest.id} value={seat} onChange={setSeat} />}

        {player && dest && (
          <p className="acr-td-move__summary" role="status">
            <Icon name="move" /> {player.name}: table {tableNumber} {seatLabel(player.seat).toLowerCase()} → table {dest.number}, {seat === null ? 'best seat (automatic)' : seatLabel(seat).toLowerCase()}
          </p>
        )}
      </div>
    </Modal>
  );
}
