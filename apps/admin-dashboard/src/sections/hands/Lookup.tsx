import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Paginated, PlayerListItemDto, TableListItemDto } from '@jpb/shared-types';
import { Icon, IconButton, Spinner, cx, formatCount } from '@jpb/ui';
import type { IconName } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';

/** Suggestions per lookup (always a server-side search, never a full list). */
export const LOOKUP_SUGGESTIONS = 8;
const MAX_TABLE_DIGITS = 7;
const MAX_PLAYER_SEARCH = 80;
/** Typing pause before a player search is sent. */
const SEARCH_DEBOUNCE_MS = 200;

interface LookupProps<T> {
  /** Visible label above the input. */
  label: string;
  /** Extra words for screen readers ("number", "name or public id"). */
  srExtra?: string;
  icon: IconName;
  placeholder: string;
  inputMode?: 'numeric' | 'text';
  sanitize: (text: string) => string;
  rows: T[];
  loading: boolean;
  text: string;
  onText: (text: string) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  optionKey: (row: T) => string;
  renderOption: (row: T) => ReactNode;
  /** Row picked by Enter when it matches the typed text exactly. */
  exact?: (row: T, text: string) => boolean;
  onPick: (row: T) => void;
  emptyText: string;
  className?: string;
}

/** WAI-ARIA combobox with a listbox popup (↑ ↓ Enter Esc) over server suggestions. */
function Lookup<T>(p: LookupProps<T>) {
  const id = useId();
  const [active, setActive] = useState(0);
  const { rows, text, open } = p;
  useEffect(() => setActive(0), [text]);
  const showList = open && text !== '';
  const listId = `${id}-list`;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      p.onOpen(true);
      if (rows.length) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % rows.length : (a - 1 + rows.length) % rows.length));
    } else if (e.key === 'Enter') {
      const pick = (p.exact ? rows.find((r) => p.exact!(r, text)) : undefined) ?? rows[active];
      if (showList && pick) {
        e.preventDefault();
        p.onPick(pick);
      }
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      p.onOpen(false);
    }
  };

  return (
    <div className={cx('acr-hands-combo', p.className)}>
      <label htmlFor={`${id}-in`} className="acr-hands-label">
        {p.label}
        {p.srExtra && <span className="jpb-sr-only"> {p.srExtra}</span>}
      </label>
      <span className="acr-hands-combo__box">
      <Icon name={p.icon} className="acr-hands-combo__icon" />
      <input
        id={`${id}-in`}
        className="jpb-input acr-hands-combo__input"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && rows[active] ? `${id}-o-${p.optionKey(rows[active]!)}` : undefined}
        inputMode={p.inputMode}
        autoComplete="off"
        placeholder={p.placeholder}
        value={text}
        onChange={(e) => {
          p.onText(p.sanitize(e.target.value));
          p.onOpen(true);
        }}
        onFocus={() => p.onOpen(true)}
        onBlur={() => setTimeout(() => p.onOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      </span>
      {showList && (
        <ul id={listId} role="listbox" aria-label={`Matching ${p.label.toLowerCase()}s`} className="acr-hands-combo__list">
          {p.loading ? (
            <li className="acr-hands-combo__note" role="presentation">
              <Spinner size="sm" /> Searching…
            </li>
          ) : rows.length === 0 ? (
            <li className="acr-hands-combo__note" role="presentation">
              {p.emptyText}
            </li>
          ) : (
            rows.map((r, i) => (
              <li
                key={p.optionKey(r)}
                id={`${id}-o-${p.optionKey(r)}`}
                role="option"
                aria-selected={i === active}
                className={cx('acr-hands-combo__opt', i === active && 'is-active')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => p.onPick(r)}
                onMouseEnter={() => setActive(i)}
              >
                {p.renderOption(r)}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** A chosen filter value with a clear button ("Table 12 ×"). */
export function FilterChip({ label, icon, children, clearLabel, onClear }: { label: string; icon: IconName; children: ReactNode; clearLabel: string; onClear: () => void }) {
  return (
    <div className="acr-hands-chipfield">
      <span className="acr-hands-label" aria-hidden="true">
        {label}
      </span>
      <div className="acr-hands-chip" role="group" aria-label={`${label} filter`}>
        <Icon name={icon} />
        <span className="acr-hands-chip__text">{children}</span>
        <IconButton icon="x" size="sm" label={clearLabel} onClick={onClear} />
      </div>
    </div>
  );
}

export interface TableChoice {
  tableId: string;
  tableNumber: number | null;
}

/** "Filter by table": type a number, the server suggests matching tables (125,000 tables are never listed). */
export function TableLookup({ tournamentId, onPick }: { tournamentId: string; onPick: (t: TableChoice) => void }) {
  const api = useApi();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const q = { q: text, sort: 'number' as const, offset: 0, limit: LOOKUP_SUGGESTIONS };
  const tables = useQuery<Paginated<TableListItemDto>>(qk.tables(tournamentId, q), (s) => api.tables.list(tournamentId, q, s), { enabled: open && text !== '' });
  return (
    <Lookup<TableListItemDto>
      label="Table"
      srExtra="number"
      icon="grid"
      placeholder="Table #"
      inputMode="numeric"
      className="acr-hands-combo--table"
      sanitize={(t) => t.replace(/[^0-9]/g, '').slice(0, MAX_TABLE_DIGITS)}
      rows={text ? (tables.data?.rows ?? []) : []}
      loading={tables.isLoading}
      text={text}
      onText={setText}
      open={open}
      onOpen={setOpen}
      optionKey={(r) => r.tableId}
      exact={(r, t) => String(r.tableNumber) === t}
      emptyText={`No table ${text}`}
      renderOption={(r) => (
        <>
          <span className="jpb-num acr-hands-combo__main">Table {r.tableNumber}</span>
          <span className="acr-hands-combo__meta">
            {formatCount(r.players)}/{r.maxSeats} · hand #{formatCount(r.handNumber)}
            {r.status === 'CLOSED' ? ' · closed' : ''}
          </span>
        </>
      )}
      onPick={(r) => {
        onPick({ tableId: r.tableId, tableNumber: r.tableNumber });
        setText('');
        setOpen(false);
      }}
    />
  );
}

export interface PlayerChoice {
  playerId: string;
  displayName: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** "Filter by player": server search by name, nickname or public id. */
export function PlayerLookup({ tournamentId, onPick }: { tournamentId: string; onPick: (p: PlayerChoice) => void }) {
  const api = useApi();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const search = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);
  const q = { q: search, sort: 'name' as const, offset: 0, limit: LOOKUP_SUGGESTIONS };
  const players = useQuery<Paginated<PlayerListItemDto>>(qk.players(tournamentId, q), (s) => api.players.list(tournamentId, q, s), { enabled: open && search !== '' });
  return (
    <Lookup<PlayerListItemDto>
      label="Player"
      srExtra="name or public id"
      icon="user"
      placeholder="Player name or JPN-…"
      className="acr-hands-combo--player"
      sanitize={(t) => t.slice(0, MAX_PLAYER_SEARCH)}
      rows={text.trim() ? (players.data?.rows ?? []) : []}
      loading={players.isLoading || search !== text.trim()}
      text={text}
      onText={setText}
      open={open}
      onOpen={setOpen}
      optionKey={(r) => r.playerId}
      exact={(r, t) => r.publicId.toLowerCase() === t.trim().toLowerCase()}
      emptyText="No matching player"
      renderOption={(r) => (
        <>
          <span className="acr-hands-combo__main">{r.displayName}</span>
          <span className="acr-hands-combo__meta jpb-mono">{r.publicId}</span>
        </>
      )}
      onPick={(r) => {
        onPick({ playerId: r.playerId, displayName: r.displayName });
        setText('');
        setOpen(false);
      }}
    />
  );
}
