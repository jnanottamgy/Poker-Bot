import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Paginated, TableListItemDto } from '@jpb/shared-types';
import { Icon, IconButton, Spinner, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';

/** Suggestions per lookup (server-side search by table number). */
export const TABLE_SUGGESTIONS = 8;
/** Table numbers have at most this many digits (125,000 tables). */
const MAX_TABLE_DIGITS = 7;

export interface TableChoice {
  tableId: string;
  /** Null when only the id is known (e.g. a shared link without the number). */
  tableNumber: number | null;
}

/**
 * "Filter by table" combobox: type a table number, the server suggests
 * matching tables (never a list of all 125,000), Enter / click picks one.
 * WAI-ARIA combobox with a listbox popup (Arrow keys, Enter, Esc).
 */
export function TableFilter({ tournamentId, value, onChange }: { tournamentId: string; value: TableChoice | null; onChange: (t: TableChoice | null) => void }) {
  const api = useApi();
  const id = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = { q: text, sort: 'number' as const, offset: 0, limit: TABLE_SUGGESTIONS };
  const tables = useQuery<Paginated<TableListItemDto>>(qk.tables(tournamentId, q), (s) => api.tables.list(tournamentId, q, s), { enabled: open && text !== '' });
  const rows = text ? (tables.data?.rows ?? []) : [];

  useEffect(() => setActive(0), [text]);

  if (value) {
    return (
      <div className="acr-players-tablechip" role="group" aria-label="Table filter">
        <Icon name="grid" />
        <span>
          {value.tableNumber === null ? (
            'Selected table'
          ) : (
            <>
              Table <strong className="jpb-num">{value.tableNumber}</strong>
            </>
          )}
        </span>
        <IconButton
          icon="x"
          size="sm"
          label={`Clear table ${value.tableNumber ?? ''} filter`.replace('  ', ' ')}
          onClick={() => {
            onChange(null);
            setText('');
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      </div>
    );
  }

  const choose = (r: TableListItemDto) => {
    onChange({ tableId: r.tableId, tableNumber: r.tableNumber });
    setOpen(false);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (rows.length) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % rows.length : (a - 1 + rows.length) % rows.length));
    } else if (e.key === 'Enter') {
      const exact = rows.find((r) => String(r.tableNumber) === text) ?? rows[active];
      if (open && exact) {
        e.preventDefault();
        choose(exact);
      }
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const listId = `${id}-list`;
  const showList = open && text !== '';
  return (
    <div className="acr-players-combo">
      <label htmlFor={`${id}-in`} className="jpb-sr-only">
        Filter by table number
      </label>
      <Icon name="grid" className="acr-players-combo__icon" />
      <input
        ref={inputRef}
        id={`${id}-in`}
        className="jpb-input acr-players-combo__input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && rows[active] ? `${id}-o-${rows[active]!.tableId}` : undefined}
        inputMode="numeric"
        autoComplete="off"
        placeholder="Table #"
        value={text}
        onChange={(e) => {
          setText(e.target.value.replace(/[^0-9]/g, '').slice(0, MAX_TABLE_DIGITS));
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label="Matching tables" className="acr-players-combo__list">
          {tables.isLoading ? (
            <li className="acr-players-combo__note" role="presentation">
              <Spinner size="sm" /> Looking up tables…
            </li>
          ) : rows.length === 0 ? (
            <li className="acr-players-combo__note" role="presentation">
              No open table {text}
            </li>
          ) : (
            rows.map((r, i) => (
              <li
                key={r.tableId}
                id={`${id}-o-${r.tableId}`}
                role="option"
                aria-selected={i === active}
                className={cx('acr-players-combo__opt', i === active && 'is-active')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
                onMouseEnter={() => setActive(i)}
              >
                <span className="jpb-num acr-players-combo__tno">T{r.tableNumber}</span>
                <span className="acr-players-combo__meta">
                  {formatCount(r.players)}/{r.maxSeats} players{r.status === 'CLOSED' ? ' · closed' : ''}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
