import { useEffect, useMemo, useState } from 'react';
import type { PlayerDetailDto, TableDetailDto } from '@jpb/shared-types';
import { Alert, Button, EmptyState, ErrorState, Icon, Select, Skeleton, cx, formatChips, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { formatTimeOfDay } from '../../lib/time';
import { useTournamentState } from '../../live/useTournamentState';
import { HandGrid } from './HandGrid';
import { FilterChip, PlayerLookup, TableLookup } from './Lookup';
import { activeHandFilters, handsQueryOf, useHandFilters } from './filters';
import type { FlagFilter, HandFilters } from './filters';
import { parseChipInput, parseHandNumber } from './model';
import { useHandPages } from './useHandPages';
import './hands.css';

const FLAG_OPTIONS = (yes: string, no: string) => [
  { value: 'any', label: 'Any' },
  { value: 'yes', label: yes },
  { value: 'no', label: no },
];

/** Number field that commits on Enter / blur (never a request per keystroke). */
function CommitField({ label, placeholder, value, parse, format, onCommit, invalidText, className }: { label: string; placeholder: string; value: number | null; parse: (t: string) => number | null; format: (n: number) => string; onCommit: (n: number | null) => void; invalidText: string; className?: string }) {
  const [text, setText] = useState(value === null ? '' : format(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(value === null ? '' : format(value));
    setInvalid(false);
  }, [value, format]);
  const commit = () => {
    if (text.trim() === '') {
      setInvalid(false);
      if (value !== null) onCommit(null);
      return;
    }
    const n = parse(text);
    setInvalid(n === null);
    if (n !== null && n !== value) onCommit(n);
  };
  return (
    <label className={cx('acr-hands-num', invalid && 'is-invalid', className)}>
      <span className="acr-hands-label">{label}</span>
      <input
        className="jpb-input acr-hands-num__input"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        aria-invalid={invalid || undefined}
        title={invalid ? invalidText : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape' && text) {
            e.stopPropagation();
            setText('');
            if (value !== null) onCommit(null);
          }
        }}
      />
      {invalid && (
        <span className="acr-hands-num__err" role="alert">
          <Icon name="warning" /> {invalidText}
        </span>
      )}
    </label>
  );
}

/** Resolves the names shown on filter chips when a link only carries ids. */
function useChipNames(filters: HandFilters) {
  const api = useApi();
  const needTable = filters.tableId !== null && filters.tableNumber === null;
  const needPlayer = filters.playerId !== null && filters.playerName === null;
  const table = useQuery<TableDetailDto>(qk.table(filters.tableId ?? '-'), (s) => api.tables.detail(filters.tableId!, s), { enabled: needTable, staleMs: 60_000 });
  const player = useQuery<PlayerDetailDto>(qk.player(filters.playerId ?? '-'), (s) => api.players.detail(filters.playerId!, s), { enabled: needPlayer, staleMs: 60_000 });
  return {
    tableNumber: filters.tableNumber ?? table.data?.view.tableNumber ?? null,
    playerName: filters.playerName ?? player.data?.displayName ?? null,
  };
}

function HandsToolbar({ tournamentId, filters, update, reset }: { tournamentId: string; filters: HandFilters; update: (p: Partial<HandFilters>) => void; reset: () => void }) {
  const names = useChipNames(filters);
  const active = activeHandFilters(filters);
  return (
    <div className="acr-hands-toolbar" role="group" aria-label="Filter hands">
      {filters.tableId ? (
        <FilterChip label="Table" icon="grid" clearLabel={`Clear table ${names.tableNumber ?? ''} filter`.replace('  ', ' ')} onClear={() => update({ tableId: null, tableNumber: null })}>
          {names.tableNumber === null ? 'Selected table' : <>Table <strong className="jpb-num">{names.tableNumber}</strong></>}
        </FilterChip>
      ) : (
        <TableLookup tournamentId={tournamentId} onPick={(t) => update({ tableId: t.tableId, tableNumber: t.tableNumber })} />
      )}
      {filters.playerId ? (
        <FilterChip label="Player" icon="user" clearLabel={`Clear player ${names.playerName ?? ''} filter`.replace('  ', ' ')} onClear={() => update({ playerId: null, playerName: null })}>
          <strong>{names.playerName ?? 'Selected player'}</strong>
        </FilterChip>
      ) : (
        <PlayerLookup tournamentId={tournamentId} onPick={(p) => update({ playerId: p.playerId, playerName: p.displayName })} />
      )}
      <CommitField label="Hand #" placeholder="any" value={filters.handNumber} parse={parseHandNumber} format={String} onCommit={(n) => update({ handNumber: n })} invalidText="Enter a hand number" className="acr-hands-num--hand" />
      <CommitField label="Min pot" placeholder="e.g. 25k" value={filters.minPot} parse={parseChipInput} format={formatChips} onCommit={(n) => update({ minPot: n })} invalidText="Chips, e.g. 25000 or 25k" className="acr-hands-num--pot" />
      <Select className="acr-hands-select" label="Showdown" value={filters.showdown} options={FLAG_OPTIONS('Showdown only', 'No showdown')} onChange={(e) => update({ showdown: e.target.value as FlagFilter })} />
      <Select className="acr-hands-select" label="All-in" value={filters.allIn} options={FLAG_OPTIONS('All-in only', 'No all-in')} onChange={(e) => update({ allIn: e.target.value as FlagFilter })} />
      {active > 0 && (
        <Button variant="ghost" size="sm" icon="x" onClick={reset} className="acr-hands-reset">
          Clear {active} filter{active === 1 ? '' : 's'}
        </Button>
      )}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="acr-hands-skeleton" aria-busy="true" aria-label="Loading hands">
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} shape="block" height={40} />
      ))}
    </div>
  );
}

/** §2.10 Hands — browse and filter the hand history; every row opens the replay. */
export default function HandsSection() {
  const tournamentId = useTournamentId();
  const canView = usePermission('HAND_HISTORY_VIEW');
  const canFairness = usePermission('FAIRNESS_VIEW');
  const state = useTournamentState(tournamentId);
  const [filters, update, reset] = useHandFilters();
  const query = useMemo(() => handsQueryOf(filters), [filters]);
  const pages = useHandPages(tournamentId, query, canView);
  const [refreshes, setRefreshes] = useState(0);
  const resetKey = `${JSON.stringify(query)}|${refreshes}`;
  const name = state.overview.data?.name;
  const started = state.overview.data ? state.overview.data.startedAt !== null : true;

  if (!canView) {
    return (
      <div className="acr-page acr-hands">
        <PageHeader title="Hands" icon="list" eyebrow={name} />
        <EmptyState icon="lock" title="Hand history is restricted" description="Your role does not include HAND_HISTORY_VIEW. Ask a tournament director for access." />
      </div>
    );
  }

  const active = activeHandFilters(filters);
  const total = pages.total;
  const showSummary = total !== null;

  let body;
  if (pages.initialLoading) body = <GridSkeleton />;
  else if (pages.error !== null && total === null) {
    const f = friendlyError(pages.error);
    body = <ErrorState title="Could not load the hand history" description={f.description} onRetry={pages.refresh} />;
  } else if (total === 0) {
    body =
      active > 0 ? (
        <EmptyState icon="search" title="No hands match these filters" description="Try a lower minimum pot, another table or player, or clear the filters." action={<Button variant="secondary" icon="x" onClick={reset}>Clear filters</Button>} />
      ) : (
        <EmptyState icon="list" title={started ? 'No completed hands yet' : 'The tournament has not started'} description={started ? 'Every hand appears here the moment it completes, with its full history and replay.' : 'Hands are recorded from the first deal after START.'} />
      );
  } else if (total !== null) {
    body = (
      <HandGrid
        tournamentId={tournamentId}
        total={total}
        rowAt={pages.rowAt}
        onRangeChange={pages.onRangeChange}
        resetKey={resetKey}
        label={`Hand history, ${formatCount(total)} hands, newest first`}
        now={pages.updatedAt || state.overview.updatedAt || 0}
      />
    );
  }

  return (
    <div className="acr-page acr-hands">
      <PageHeader
        title="Hands"
        icon="list"
        eyebrow={name}
        description="Every completed hand, newest first. Open one for the full history and an action-by-action replay."
        actions={
          canFairness ? (
            <ButtonLink to={sectionHref('fairness', tournamentId)} icon="shield">
              Fairness & verification
            </ButtonLink>
          ) : undefined
        }
      />
      <HandsToolbar tournamentId={tournamentId} filters={filters} update={update} reset={reset} />
      <div className="acr-hands-summary" aria-live="polite">
        {showSummary ? (
          <span>
            <strong className="jpb-num">{formatCount(total)}</strong> {total === 1 ? 'hand' : 'hands'}
            {active > 0 ? ' match the filters' : ' completed'}
            {pages.updatedAt > 0 && <span className="acr-hands-dim"> · as of {formatTimeOfDay(pages.updatedAt)}</span>}
          </span>
        ) : (
          <span className="acr-hands-dim">Counting hands…</span>
        )}
        {pages.newHands > 0 && (
          <Button
            size="sm"
            variant="primary"
            icon="arrow-up"
            onClick={() => {
              pages.refresh();
              setRefreshes((n) => n + 1);
            }}
          >
            {formatCount(pages.newHands)} new {pages.newHands === 1 ? 'hand' : 'hands'} — show
          </Button>
        )}
      </div>
      {pages.stale && (
        <Alert severity="WARNING" title="Showing the last loaded hands" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={pages.refresh}>Retry</Button>}>
          A refresh failed, so some rows may be out of date. Completed hands never change; only new hands may be missing.
        </Alert>
      )}
      <div className={cx('acr-hands-body', pages.stale && 'jpb-stale')} data-stale={pages.stale ? 'true' : undefined}>
        {body}
      </div>
    </div>
  );
}
