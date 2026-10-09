import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlayerListItemDto } from '@jpb/shared-types';
import { Alert, Button, EmptyState, ErrorState, Icon, Panel, SearchInput, Select, Skeleton, cx, formatCount } from '@jpb/ui';
import { friendlyError } from '../../api/errors';
import type { PlayerSort } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentState } from '../../live/useTournamentState';
import { formatTimeOfDay } from '../../lib/time';
import { activePlayerFilters, MAX_SEARCH_LENGTH, usePlayerFilters } from './filters';
import { SORTS, SORT_META, STATUS_FILTERS, defaultSort, hasStarted, playersQuery } from './model';
import type { StatusFilter } from './model';
import { PlayerGrid } from './PlayerGrid';
import { SummaryChips } from './SummaryChips';
import { TableFilter } from './TableFilter';
import { BULK_APPROVE_MAX, useBulkApprove } from './useBulkApprove';
import { usePlayerPages } from './usePlayerPages';
import './players.css';

/** Typing pauses this long before the server search runs. */
const SEARCH_DEBOUNCE_MS = 300;

function ListSkeleton() {
  return (
    <div className="acr-players-skeleton" aria-busy="true" aria-label="Loading players">
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} shape="block" height={40} />
      ))}
    </div>
  );
}

/** §2.7 Players — every player of the tournament, server-paginated and virtualized. */
export default function PlayersSection() {
  const tournamentId = useTournamentId();
  const state = useTournamentState(tournamentId);
  const overview = state.overview.data;
  const canApprove = usePermission('PLAYER_APPROVE_REGISTRATION');
  const [filters, update, reset] = usePlayerFilters();
  const [text, setText] = useState(filters.q);
  const [selected, setSelected] = useState<Map<string, string>>(() => new Map());
  const bulk = useBulkApprove(tournamentId);

  // Debounced search → URL (the URL is the source of truth for the query).
  useEffect(() => {
    if (text === filters.q) return undefined;
    const t = setTimeout(() => update({ q: text }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, filters.q, update]);
  // External changes (reset, back button) flow back into the box.
  useEffect(() => setText(filters.q), [filters.q]);

  const sort: PlayerSort = filters.sort ?? defaultSort(state.status);
  const base = useMemo(() => playersQuery(filters.q, filters.status, filters.tableId, sort), [filters.q, filters.status, filters.tableId, sort]);
  const pages = usePlayerPages(tournamentId, base);
  const resetKey = JSON.stringify(base);

  const total = pages.total ?? 0;
  const bigBlind = state.currentLevel?.bigBlind ?? null;
  const awayAfter = overview?.config.timing.awayAfterTimeouts ?? null;
  const active = activePlayerFilters(filters);
  const now = Date.now() + state.offsetMs;

  // Bulk approval works on the pending rows loaded on screen (and stays selected while scrolling).
  const loadedPending = useMemo(() => (canApprove ? pages.loaded.filter((r) => r.status === 'PENDING_APPROVAL') : []), [canApprove, pages.loaded]);
  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  const selectedLoaded = loadedPending.filter((r) => selected.has(r.playerId)).length;

  const toggle = useCallback((r: PlayerListItemDto) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r.playerId)) next.delete(r.playerId);
      else if (next.size < BULK_APPROVE_MAX) next.set(r.playerId, r.displayName);
      return next;
    });
  }, []);
  const toggleLoaded = (on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of loadedPending) {
        if (!on) next.delete(r.playerId);
        else if (next.size < BULK_APPROVE_MAX) next.set(r.playerId, r.displayName);
      }
      return next;
    });

  const approveSelected = () =>
    void bulk.run(
      [...selected].map(([playerId, displayName]) => ({ playerId, displayName })),
      (r) =>
        setSelected((prev) => {
          const next = new Map(prev);
          for (const id of r.approved) next.delete(id);
          return next;
        }),
    );

  const statusLabel = filters.status ? (STATUS_FILTERS.find((s) => s.value === filters.status)?.label ?? filters.status) : null;

  return (
    <div className="acr-page acr-players">
      <PageHeader
        title="Players"
        icon="users"
        eyebrow={overview?.name ?? 'Tournament'}
        description="Search, filter and sort every player. Paging, search and filters run on the server, so this list behaves the same at 8 players or 1,000,000."
        actions={
          <>
            <ButtonLink to={sectionHref('registration', tournamentId)} icon="user">
              Registration
            </ButtonLink>
            <ButtonLink to={sectionHref('standings', tournamentId)} icon="award">
              Standings
            </ButtonLink>
          </>
        }
      />

      <SummaryChips tournamentId={tournamentId} counters={state.counters} started={hasStarted(state.status)} maxPlayers={overview?.config.maxPlayers ?? null} status={filters.status} onStatus={(s: StatusFilter) => update({ status: s })} />

      <div className="acr-players-toolbar" role="search" aria-label="Filter players">
        <SearchInput
          className="acr-players-search"
          value={text}
          onChange={(v) => setText(v.slice(0, MAX_SEARCH_LENGTH))}
          label="Search players"
          placeholder="Name, nickname or public id (JPN-…)"
          resultSummary={pages.total === null ? undefined : `${formatCount(total)} players`}
        />
        <Select
          className="acr-players-filter"
          label="Status"
          hideLabel
          value={filters.status}
          onChange={(e) => update({ status: e.target.value as StatusFilter })}
          options={STATUS_FILTERS.map((s) => ({ value: s.value, label: s.value ? s.label : 'All statuses' }))}
        />
        <TableFilter
          tournamentId={tournamentId}
          value={filters.tableId ? { tableId: filters.tableId, tableNumber: filters.tableNumber } : null}
          onChange={(t) => update({ tableId: t?.tableId ?? null, tableNumber: t?.tableNumber ?? null })}
        />
        <Select className="acr-players-sortsel" label="Sort" hideLabel value={sort} onChange={(e) => update({ sort: e.target.value as PlayerSort })} options={SORTS.map((s) => ({ value: s, label: `Sort: ${SORT_META[s].label}` }))} />
        {active > 0 && (
          <Button size="sm" variant="ghost" icon="x" onClick={reset}>
            Clear {active === 1 ? 'filter' : `${active} filters`}
          </Button>
        )}
      </div>

      <Panel
        flush
        className="acr-players-panel"
        title={
          <span className="acr-players-count">
            {pages.total === null ? 'Players' : `${formatCount(total)} ${total === 1 ? 'player' : 'players'}`}
            {statusLabel && <span className="acr-players-countsub"> · {statusLabel.toLowerCase()}</span>}
            {filters.tableNumber !== null && <span className="acr-players-countsub"> · table {filters.tableNumber}</span>}
            {filters.q && <span className="acr-players-countsub"> · “{filters.q}”</span>}
          </span>
        }
        description={`Sorted by ${SORT_META[sort].label.toLowerCase()}. ↑ ↓ to move, Enter to open${canApprove ? ', Space to select a pending registration' : ''}.`}
        actions={
          <span className="acr-players-panelactions">
            {pages.updatedAt > 0 && <span className={cx('acr-players-updated', pages.stale && 'is-stale')}>{pages.stale ? 'Not current · ' : 'Updated '}{formatTimeOfDay(pages.updatedAt)}</span>}
            <Button size="sm" variant="ghost" icon="refresh" onClick={pages.refetch}>
              Refresh
            </Button>
          </span>
        }
      >
        {pages.stale && (
          <div className="acr-players-alert">
            <Alert severity="WARNING" title="Could not refresh the list" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={pages.refetch}>Retry</Button>}>
              The rows below are greyed: they are the last data received, not live.
            </Alert>
          </div>
        )}

        {canApprove && (selected.size > 0 || bulk.progress || bulk.last) && (
          <div className="acr-players-bulk" role="region" aria-label="Bulk approval">
            {bulk.progress ? (
              <span className="acr-players-bulk__text" aria-live="polite">
                <Icon name="refresh" /> Approving {formatCount(bulk.progress.done)} of {formatCount(bulk.progress.total)}…
              </span>
            ) : (
              <span className="acr-players-bulk__text" aria-live="polite">
                <strong className="jpb-num">{formatCount(selected.size)}</strong> pending registration{selected.size === 1 ? '' : 's'} selected
                {selected.size >= BULK_APPROVE_MAX && <span className="acr-players-dim"> (maximum {BULK_APPROVE_MAX} per batch)</span>}
              </span>
            )}
            <span className="acr-players-bulk__actions">
              <Button size="sm" variant="primary" icon="check" disabled={selected.size === 0 || bulk.progress !== null} onClick={approveSelected}>
                Approve {selected.size > 0 ? formatCount(selected.size) : ''}
              </Button>
              <Button size="sm" variant="ghost" icon="x" disabled={bulk.progress !== null} onClick={() => { setSelected(new Map()); bulk.clearLast(); }}>
                Clear
              </Button>
            </span>
            {bulk.last && bulk.last.failed.length > 0 && (
              <ul className="acr-players-bulk__failed" aria-label="Registrations that could not be approved">
                {bulk.last.failed.map((f) => (
                  <li key={f.playerId}>
                    <Icon name="warning" /> <strong>{f.displayName}</strong> — {f.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {pages.initialLoading ? (
          <ListSkeleton />
        ) : pages.error ? (
          <ErrorState title="Could not load players" description={friendlyError(pages.error).description} onRetry={pages.refetch} />
        ) : total === 0 ? (
          <EmptyState
            icon="users"
            title={active > 0 ? 'No player matches these filters' : 'No players yet'}
            description={
              active > 0
                ? 'Try another name, nickname or public id, or clear the filters.'
                : 'Players appear here as soon as they register with the join link or QR code.'
            }
            action={
              active > 0 ? (
                <Button variant="secondary" icon="x" onClick={reset}>
                  Clear filters
                </Button>
              ) : (
                <ButtonLink to={sectionHref('registration', tournamentId)} icon="user">
                  Open registration
                </ButtonLink>
              )
            }
          />
        ) : (
          <div className={cx('acr-players-gridwrap', pages.stale && 'jpb-stale')}>
            <PlayerGrid
              tournamentId={tournamentId}
              total={total}
              rowAt={pages.rowAt}
              onRangeChange={pages.onRangeChange}
              resetKey={resetKey}
              sort={sort}
              onSort={(s) => update({ sort: s })}
              bigBlind={bigBlind}
              awayAfterTimeouts={awayAfter}
              selectable={canApprove}
              selected={selectedIds}
              onToggle={toggle}
              onToggleLoaded={toggleLoaded}
              loadedPending={loadedPending.length}
              selectedLoaded={selectedLoaded}
              label={`Players${statusLabel ? ` — ${statusLabel}` : ''}`}
              now={now}
              started={hasStarted(state.status)}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}
