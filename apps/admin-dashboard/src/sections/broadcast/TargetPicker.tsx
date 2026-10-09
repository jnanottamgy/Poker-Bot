import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Paginated, PlayerListItemDto, TableListItemDto } from '@jpb/shared-types';
import { Icon, IconButton, Spinner, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';

/** Suggestions per lookup: the server searches; we never list all 125,000 tables or 1,000,000 players. */
export const PICKER_SUGGESTIONS = 8;
const SEARCH_DEBOUNCE_MS = 200;
/** Player search starts at two characters (one letter matches far too many). */
const MIN_PLAYER_QUERY = 2;
const MAX_TABLE_DIGITS = 7;
const MAX_PLAYER_QUERY = 80;

export interface PickedTable {
  kind: 'table';
  id: string;
  tableNumber: number;
  label: string;
}
export interface PickedPlayer {
  kind: 'player';
  id: string;
  displayName: string;
  publicId: string;
  label: string;
}
export type Picked = PickedTable | PickedPlayer;

interface Option {
  id: string;
  primary: string;
  secondary: string;
  value: Picked;
}

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface TargetPickerProps<K extends Picked['kind']> {
  kind: K;
  tournamentId: string;
  value: Extract<Picked, { kind: K }> | null;
  onChange: (v: Extract<Picked, { kind: K }> | null) => void;
  label: string;
  disabled?: boolean;
  /** Hint under the field. */
  hint?: string;
}

/**
 * Combobox that asks the server for matching tables (by number) or players
 * (by name, nickname or public id). Arrow keys / Enter / Escape; the chosen
 * target shows as a chip with a clear button.
 */
export function TargetPicker<K extends Picked['kind']>({ kind, tournamentId, value, onChange, label, disabled, hint }: TargetPickerProps<K>) {
  const api = useApi();
  const id = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);
  const isTable = kind === 'table';
  const ready = isTable ? q !== '' : q.length >= MIN_PLAYER_QUERY;
  const tq = { q, sort: 'number' as const, offset: 0, limit: PICKER_SUGGESTIONS };
  const pq = { q, offset: 0, limit: PICKER_SUGGESTIONS };
  const tables = useQuery<Paginated<TableListItemDto>>(qk.tables(tournamentId, tq), (s) => api.tables.list(tournamentId, tq, s), { enabled: isTable && open && ready });
  const players = useQuery<Paginated<PlayerListItemDto>>(qk.players(tournamentId, pq), (s) => api.players.list(tournamentId, pq, s), { enabled: !isTable && open && ready });
  const loading = isTable ? tables.isLoading : players.isLoading;
  const failed = isTable ? tables.error && !tables.data : players.error && !players.data;

  const options: Option[] = !ready
    ? []
    : isTable
      ? (tables.data?.rows ?? []).map((t) => ({
          id: t.tableId,
          primary: `Table ${t.tableNumber}`,
          secondary: `${formatCount(t.players)}/${t.maxSeats} players${t.isFinalTable ? ' · final table' : ''}${t.status === 'CLOSED' ? ' · closed' : ''}`,
          value: { kind: 'table', id: t.tableId, tableNumber: t.tableNumber, label: `Table ${t.tableNumber}` },
        }))
      : (players.data?.rows ?? []).map((p) => ({
          id: p.playerId,
          primary: p.displayName,
          secondary: `${p.publicId}${p.tableNumber !== null ? ` · T${p.tableNumber}` : ''} · ${p.status.replace(/_/g, ' ').toLowerCase()}`,
          value: { kind: 'player', id: p.playerId, displayName: p.displayName, publicId: p.publicId, label: `${p.displayName} (${p.publicId})` },
        }));

  useEffect(() => setActive(0), [q]);

  if (value) {
    return (
      <div className="acr-broadcast-picked" role="group" aria-label={label}>
        <Icon name={isTable ? 'grid' : 'user'} />
        <span className="acr-broadcast-picked__text">{value.label}</span>
        <IconButton
          icon="x"
          size="sm"
          label={`Clear ${value.label}`}
          disabled={disabled}
          onClick={() => {
            onChange(null);
            setText('');
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      </div>
    );
  }

  const choose = (o: Option) => {
    onChange(o.value as Extract<Picked, { kind: K }>);
    setOpen(false);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % options.length : (a - 1 + options.length) % options.length));
    } else if (e.key === 'Enter') {
      const exact = isTable ? options.find((o) => o.value.kind === 'table' && String(o.value.tableNumber) === text.trim()) : undefined;
      const pick = exact ?? options[active];
      if (open && pick) {
        e.preventDefault();
        choose(pick);
      }
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const listId = `${id}-list`;
  const showList = open && text.trim() !== '';
  const note = !ready ? (isTable ? 'Type a table number' : `Type at least ${MIN_PLAYER_QUERY} characters`) : loading ? null : failed ? 'Search failed — try again' : options.length === 0 ? (isTable ? `No table ${q}` : `No player matches “${q}”`) : null;
  return (
    <div className="jpb-field acr-broadcast-combo">
      <label htmlFor={`${id}-in`} className="jpb-field__label">
        {label}
      </label>
      <div className="acr-broadcast-combo__wrap">
        <Icon name={isTable ? 'grid' : 'search'} className="acr-broadcast-combo__icon" />
        <input
          ref={inputRef}
          id={`${id}-in`}
          className="jpb-input acr-broadcast-combo__input"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={hint ? `${id}-hint` : undefined}
          aria-activedescendant={showList && options[active] ? `${id}-o-${options[active]!.id}` : undefined}
          inputMode={isTable ? 'numeric' : 'search'}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={isTable ? 'Table number, e.g. 12' : 'Name, nickname or public id (JPN-…)'}
          value={text}
          onChange={(e) => {
            const v = isTable ? e.target.value.replace(/[^0-9]/g, '').slice(0, MAX_TABLE_DIGITS) : e.target.value.slice(0, MAX_PLAYER_QUERY);
            setText(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        {showList && (
          <ul id={listId} role="listbox" aria-label={isTable ? 'Matching tables' : 'Matching players'} className="acr-broadcast-combo__list">
            {loading && ready ? (
              <li className="acr-broadcast-combo__note" role="presentation">
                <Spinner size="sm" /> Searching…
              </li>
            ) : note ? (
              <li className="acr-broadcast-combo__note" role="presentation">
                {note}
              </li>
            ) : (
              options.map((o, i) => (
                <li
                  key={o.id}
                  id={`${id}-o-${o.id}`}
                  role="option"
                  aria-label={`${o.primary}, ${o.secondary}`}
                  aria-selected={i === active}
                  className={cx('acr-broadcast-combo__opt', i === active && 'is-active')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className="acr-broadcast-combo__primary">{o.primary}</span>
                  <span className="acr-broadcast-combo__secondary">{o.secondary}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="jpb-field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}
