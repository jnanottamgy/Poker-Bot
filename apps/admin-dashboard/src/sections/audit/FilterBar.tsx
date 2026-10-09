import { useEffect, useId, useState } from 'react';
import { Button, Icon } from '@jpb/ui';
import { ACTION_GROUPS, AUDIT_ACTIONS, MAX_TARGET_LENGTH, activeFilterCount } from './model';
import type { AuditFilters } from './model';

const TARGET_DEBOUNCE_MS = 300;
const HOUR = 3_600_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Epoch ms → value for <input type="datetime-local"> in the browser's zone. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function startOfToday(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface AuditFilterBarProps {
  filters: AuditFilters;
  onChange: (patch: Partial<AuditFilters>) => void;
  adminOptions: Array<{ value: string; label: string }>;
  /** Actions present in the loaded entries (unknown ones are offered too). */
  seenActions: string[];
}

/** Admin · action · target · date range, kept in the URL so a filtered view can be shared. */
export function AuditFilterBar({ filters, onChange, adminOptions, seenActions }: AuditFilterBarProps) {
  const id = useId();
  const [target, setTarget] = useState(filters.target);
  useEffect(() => setTarget(filters.target), [filters.target]);
  useEffect(() => {
    if (target === filters.target) return undefined;
    const t = setTimeout(() => onChange({ target }), TARGET_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [target, filters.target, onChange]);

  const unknown = seenActions.filter((a) => !AUDIT_ACTIONS[a]).sort();
  if (filters.action && !AUDIT_ACTIONS[filters.action] && !unknown.includes(filters.action)) unknown.push(filters.action);
  const active = activeFilterCount(filters);
  const quick = (label: string, from: () => number) => (
    <button
      type="button"
      className="acr-audit-quick"
      onClick={() => {
        const now = Date.now();
        onChange({ from: toLocalInput(from()), to: toLocalInput(now) });
      }}
    >
      {label}
    </button>
  );

  return (
    <section className="acr-audit-filters" aria-label="Filter the audit log">
      <div className="acr-audit-filters__field">
        <label htmlFor={`${id}-admin`}>Admin</label>
        <span className="jpb-select-wrap">
          <select id={`${id}-admin`} className="jpb-input jpb-select" value={filters.adminId} onChange={(e) => onChange({ adminId: e.target.value })}>
            <option value="">Any admin</option>
            {adminOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" className="jpb-select__chevron" />
        </span>
      </div>
      <div className="acr-audit-filters__field">
        <label htmlFor={`${id}-action`}>Action</label>
        <span className="jpb-select-wrap">
          <select id={`${id}-action`} className="jpb-input jpb-select" value={filters.action} onChange={(e) => onChange({ action: e.target.value })}>
            <option value="">Any action</option>
            {ACTION_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {Object.entries(AUDIT_ACTIONS)
                  .filter(([, info]) => info.group === g)
                  .map(([code, info]) => (
                    <option key={code} value={code}>
                      {info.label}
                      {info.danger ? ' (L2)' : ''}
                    </option>
                  ))}
              </optgroup>
            ))}
            {unknown.length > 0 && (
              <optgroup label="Other">
                {unknown.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <Icon name="chevron-down" className="jpb-select__chevron" />
        </span>
      </div>
      <div className="acr-audit-filters__field is-wide">
        <label htmlFor={`${id}-target`}>Target contains</label>
        <input
          id={`${id}-target`}
          className="jpb-input"
          type="search"
          value={target}
          maxLength={MAX_TARGET_LENGTH}
          placeholder="player:JPN-7A42, table:37, admin:…"
          onChange={(e) => setTarget(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onChange({ target });
          }}
        />
      </div>
      <div className="acr-audit-filters__field">
        <label htmlFor={`${id}-from`}>From</label>
        <input id={`${id}-from`} className="jpb-input" type="datetime-local" value={filters.from} max={filters.to || undefined} onChange={(e) => onChange({ from: e.target.value })} />
      </div>
      <div className="acr-audit-filters__field">
        <label htmlFor={`${id}-to`}>To</label>
        <input id={`${id}-to`} className="jpb-input" type="datetime-local" value={filters.to} min={filters.from || undefined} onChange={(e) => onChange({ to: e.target.value })} />
      </div>
      <div className="acr-audit-filters__quick" role="group" aria-label="Quick date ranges">
        {quick('Last hour', () => Date.now() - HOUR)}
        {quick('Last 24 h', () => Date.now() - 24 * HOUR)}
        {quick('Today', () => startOfToday(Date.now()))}
        {(filters.from || filters.to) && (
          <button type="button" className="acr-audit-quick" onClick={() => onChange({ from: '', to: '' })}>
            Any time
          </button>
        )}
      </div>
      {active > 0 && (
        <Button size="sm" variant="ghost" icon="x" className="acr-audit-filters__clear" onClick={() => onChange({ adminId: '', action: '', target: '', from: '', to: '' })}>
          Clear {active} {active === 1 ? 'filter' : 'filters'}
        </Button>
      )}
      <p className="acr-audit-filters__note">
        <Icon name="info" /> Admin, action and target are filtered on the server; the date range is applied while paging (newest first) and stops at the range start.
      </p>
    </section>
  );
}
