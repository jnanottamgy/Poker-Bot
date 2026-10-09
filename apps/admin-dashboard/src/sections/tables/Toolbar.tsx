import { useEffect, useId, useState } from 'react';
import { Button, Icon, SearchInput, cx } from '@jpb/ui';
import type { TableListStatus } from '../../api/types';
import { MAX_SEATS_LIMIT, SORT_LABEL, activeFilterCount } from './filters';
import type { TableFilters, TableSort } from './filters';
import type { MapView } from './TableGrid';
import { DISPLAY_STATUS_META } from './tableStatus';

/** Typing pauses this long before the server is asked (one request per search, not per key). */
export const SEARCH_DEBOUNCE_MS = 250;

const STATUS_OPTIONS: ReadonlyArray<{ value: TableListStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'IN_HAND', label: DISPLAY_STATUS_META.IN_HAND.label },
  { value: 'BETWEEN_HANDS', label: DISPLAY_STATUS_META.BETWEEN_HANDS.label },
  { value: 'WAITING', label: DISPLAY_STATUS_META.WAITING.label },
  { value: 'HELD', label: DISPLAY_STATUS_META.HELD.label },
  { value: 'STALLED', label: DISPLAY_STATUS_META.STALLED.label },
  { value: 'CLOSED', label: DISPLAY_STATUS_META.CLOSED.label },
];

function PlayersInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const id = useId();
  return (
    <span className="acr-tables-range__field">
      <label htmlFor={id} className="jpb-sr-only">
        {label}
      </label>
      <input
        id={id}
        className="jpb-input acr-tables-range__input jpb-num"
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_SEATS_LIMIT}
        step={1}
        placeholder={label.startsWith('Min') ? 'min' : 'max'}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(null);
          const n = Math.trunc(Number(raw));
          if (Number.isFinite(n)) onChange(Math.min(MAX_SEATS_LIMIT, Math.max(0, n)));
        }}
      />
    </span>
  );
}

export interface ToolbarProps {
  filters: TableFilters;
  onChange: (patch: Partial<TableFilters>) => void;
  onReset: () => void;
  /** Enter in the search box: open the table with exactly this number when it is in the results. */
  onSubmitSearch: (q: string) => void;
  resultText: string;
}

/** Search by number, status, player range, stalled / disconnected toggles, sort and grid ⇄ list. */
export function Toolbar({ filters, onChange, onReset, onSubmitSearch, resultText }: ToolbarProps) {
  const [q, setQ] = useState(filters.q);
  const statusId = useId();
  const sortId = useId();

  useEffect(() => setQ(filters.q), [filters.q]);
  useEffect(() => {
    if (q === filters.q) return undefined;
    const t = setTimeout(() => onChange({ q }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, filters.q, onChange]);

  const rangeInvalid = filters.minPlayers !== null && filters.maxPlayers !== null && filters.minPlayers > filters.maxPlayers;
  const active = activeFilterCount(filters);
  return (
    <div className="acr-tables-toolbar" role="toolbar" aria-label="Table map filters">
      <form
        className="acr-tables-toolbar__search"
        onSubmit={(e) => {
          e.preventDefault();
          onChange({ q });
          onSubmitSearch(q);
        }}
      >
        <SearchInput
          value={q}
          onChange={(v) => setQ(v.replace(/[^0-9]/g, '').slice(0, 7))}
          label="Search by table number"
          placeholder="Table number…"
          inputMode="numeric"
          resultSummary={resultText}
        />
      </form>

      <span className="acr-tables-toolbar__field">
        <label htmlFor={statusId} className="acr-tables-toolbar__label">
          Status
        </label>
        <span className="jpb-select-wrap">
          <select id={statusId} className="jpb-input jpb-select" value={filters.status} onChange={(e) => onChange({ status: e.target.value as TableListStatus | '' })}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" className="jpb-select__chevron" />
        </span>
      </span>

      <fieldset className={cx('acr-tables-range', rangeInvalid && 'is-invalid')}>
        <legend className="acr-tables-toolbar__label">Players</legend>
        <PlayersInput label="Minimum players" value={filters.minPlayers} onChange={(v) => onChange({ minPlayers: v })} />
        <span aria-hidden="true">–</span>
        <PlayersInput label="Maximum players" value={filters.maxPlayers} onChange={(v) => onChange({ maxPlayers: v })} />
        {rangeInvalid && (
          <span className="acr-tables-range__err" role="alert">
            <Icon name="warning" /> min &gt; max
          </span>
        )}
      </fieldset>

      <div className="acr-tables-toolbar__toggles" role="group" aria-label="Quick filters">
        <button type="button" className={cx('acr-tables-toggle', filters.stalled && 'is-on', 'is-danger')} aria-pressed={filters.stalled} onClick={() => onChange({ stalled: !filters.stalled })}>
          <Icon name={filters.stalled ? 'check' : 'warning'} /> Stalled only
        </button>
        <button
          type="button"
          className={cx('acr-tables-toggle', filters.disconnected && 'is-on')}
          aria-pressed={filters.disconnected}
          onClick={() => onChange({ disconnected: !filters.disconnected })}
        >
          <Icon name={filters.disconnected ? 'check' : 'wifi-off'} /> Has disconnected
        </button>
      </div>

      <span className="acr-tables-toolbar__field">
        <label htmlFor={sortId} className="acr-tables-toolbar__label">
          Sort
        </label>
        <span className="jpb-select-wrap">
          <select id={sortId} className="jpb-input jpb-select" value={filters.sort} onChange={(e) => onChange({ sort: e.target.value as TableSort })}>
            {(Object.keys(SORT_LABEL) as TableSort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" className="jpb-select__chevron" />
        </span>
      </span>

      <div className="acr-tables-viewswitch" role="group" aria-label="Layout">
        {(['grid', 'list'] as MapView[]).map((v) => (
          <button key={v} type="button" className={cx('acr-tables-viewswitch__btn', filters.view === v && 'is-on')} aria-pressed={filters.view === v} onClick={() => onChange({ view: v })}>
            <Icon name={v === 'grid' ? 'grid' : 'list'} /> {v === 'grid' ? 'Grid' : 'List'}
          </button>
        ))}
      </div>

      {active > 0 && (
        <Button size="sm" variant="ghost" icon="x" onClick={onReset}>
          Clear {active} filter{active === 1 ? '' : 's'}
        </Button>
      )}
    </div>
  );
}
