# Tables (§2.5) and Table detail (§2.6)

Code: `sections/tables/` (live table map) and `sections/table-detail/` (one
table, live). Both only display server data; every change goes through
`useDangerousAction()` with the danger level and confirmation word of
`api/endpoints.ts`, and the server re-checks permission and scope.

## Live table map (`tables/`)

- **Server-side paging, virtualized grid.** `useTableMap` asks the server only
  for the pages (`MAP_PAGE_SIZE` = 120 rows) that cover the rows on screen;
  `TableGrid` (@tanstack/react-virtual, fixed row heights, nothing measured)
  renders only those rows. `count` is the server's `total`, so the scrollbar
  covers all tables (125,000 tables cost the same as 100). Pages on screen are
  polled every 5 s and refreshed by live tournament events (`['t', id, 'tables']`).
- **Filters, sort, search** are URL parameters (`status`, `min`, `max`,
  `stalled`, `offline`, `q`, `sort`, `view`) → `TablesQuery` (`serverQuery`).
- **Summary bar:** one `limit=1` request per server status reads its `total`;
  the statuses partition the tables, so their sum is the exact total.
- **Status projection** (`tableStatus.ts`): CLOSED > FROZEN > STALLED >
  BREAKING > HELD (with reasons) > IN_HAND / BETWEEN_HANDS / WAITING. Always
  icon + text; normal play is neutral so exceptions stand out.
- **"Since progress"** ticks every second on the server clock
  (`Date.now() + serverOffsetMs - lastProgressAt`); amber after 45 s, red when
  the server says STALLED.
- **Keyboard:** arrows / Home / End / PageUp / PageDown move between tiles
  (scrolling the virtual list), Enter opens the table; Enter in the search box
  opens an exact table-number match.

## Table detail (`table-detail/`)

- **Data:** the admin socket `watch`es the table (`useWatchedTable`); REST
  `tableDetail` adds internals, recent hands and hole cards after a reveal and
  stands in while the socket is down (polling 3 s, else 8 s). The view with the
  higher `version` wins. The director's row (`tablesList?q=<n>&sort=number&limit=1`)
  supplies STALLED, the final-table flag and the chips the director expects.
- **Oval:** `seatLayout()` puts a bottom row, a top row and (from 5 seats) one
  seat on each round end of a racetrack rail; rows and ends are separated
  vertically, so seat cards never overlap (property-tested for 2-10 seats).
  Seat 0 is bottom centre, clockwise. Narrow panels (< 860 px) list the seats
  in a grid under the felt.
- **Action log:** the actor's authoritative `handActionLog` when present; else
  rebuilt from the live `table_update` events received since the table was
  opened (`logFromEvents`).
- **Stats:** the actor's running `counters` when present, else the recent
  hands (labelled "based on the last N hands").
- **Hole cards:** hidden by default. "Reveal live hole cards" is level 2
  (`REVEAL` + reason, `VIEW_HOLE_CARDS`); afterwards they can be hidden/shown
  locally without a new reveal (the audit entry stays).

## Contract notes (changes requested outside these folders)

1. `TableListItemDto` has no BREAKING state (the director's
   `TableSummary.status`). The UI reads an optional `breaking: boolean` if the
   server adds it, else treats a `CONSOLIDATION` hold as breaking.
2. `tablesList` has no `disconnected` filter: "Has disconnected" scans up to
   `MAX_SCAN_TABLES` (5,000) rows in the current sort order and says so.
   Requested: `disconnected=true` server-side.
3. No server filter/count for FROZEN or BREAKING: the summary shows them only
   when `overview.tablesByStatus` contains those keys (the mock does).
4. `q` (number prefix) and `sort` (`number|players|stall|chips`) are used and
   implemented by the server but are not documented in docs/API.md.
5. Without `status`, the server includes CLOSED tables; the mock excludes them.
6. `force-timeout` takes no `turnVersion`: if the turn passes before the
   confirmation, the next actor is timed out. Requested: `{ reason, turnVersion }`.
7. `adjust-stack` accepts `newStack >= 0`, but the table engine rejects 0 and
   any adjustment mid-hand (`HAND_IN_PROGRESS`), asynchronously, so the admin
   gets `ok` for a change that never happens. The UI requires >= 1 and no hand
   in progress. Requested: validate synchronously and return the refusal.
8. No endpoint previews the seat-fairness score of each free seat for a move;
   the dialog offers "Automatic (recommended)" or a free seat and points to the
   score breakdown in the player's movement history.
9. The server implements `POST /api/admin/tables/:tableId/add-time`, but it is
   not in docs/API.md / `ENDPOINTS`, so it is not offered here.
10. Mock backend: the live view has no `handActionLog`, `counters`, `turn`,
    `positions`; `table_update` frames carry no events and the event log only
    has `TABLE_STATUS_CHANGED`, so the action log stays empty in mock mode, and
    the mock pot is not taken from the stacks (Σ stacks + pot ≠ actor chips).
