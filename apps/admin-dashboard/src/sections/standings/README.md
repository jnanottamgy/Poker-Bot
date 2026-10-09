# Standings (§2.12)

Two lists that are never confused, plus the prize ladder alongside.

- **Views** (URL `?view=stack|finish`, segmented tabs with a real tabpanel):
  - **Current stack ranking** — `GET /tournaments/:id/standings?mode=stack` (players SEATED,
    IN_TRANSIT, SUSPENDED, largest stack first). Explicitly says "This is NOT a result".
    Columns: rank, player (+ public id), status, table, stack (chips + BB, BB truncated to one
    decimal like `StackDisplay`), share of all chips (bar relative to the chip leader), × average.
  - **Finishing positions** — `mode=finish`, elimination order best place first; ties show a
    `T×n` badge (spoken "Tied with n other players") and the places the tie covers
    ("5th–6th"); prize per row; the champion row is gold.
- **Scale:** `usePagedRows` asks the server only for the pages (`STANDINGS_PAGE_SIZE` = 100)
  covering the rows on screen; `VirtualGrid` (@tanstack/react-virtual, fixed row height)
  renders only those rows. `aria-rowcount` = server total, so 8 or 1,000,000 players behave
  the same. "Go to rank / place" scrolls the virtual list: rank → index `rank − 1`; place →
  index `place − first place listed` (positions are contiguous except for the places a tie
  skips, CONTRACTS.md "Eliminations & ranking"). If a jump lands only on unloaded pages, the
  last known total keeps the list mounted with skeleton rows (it never restarts at the top).
- **Live:** stack view polled every 5 s, finish view every 15 s, and both invalidated by
  live eliminations / moves (`live/invalidation.ts`). "Live" pill only when the socket is live
  AND the last refresh succeeded; a failed refresh greys the rows (`jpb-stale`) with a retry.
- **Prize ladder** (`PrizeLadder.tsx`): equal consecutive prizes collapse into bands
  (`ladderBands`, labelled places never merge) so 100,000 paid places stay readable; each band
  is Decided / Deciding / In play (positions above the players remaining are decided); the band
  the next elimination lands in is "Next out"; money bubble state (`bubbleState`): N to the money,
  on the bubble, in the money, complete. Prize notes from the config.
- **Export:** "Export CSV" downloads `standings.csv?mode=<view>` through the API client
  (`reports/DownloadButton.tsx`: friendly toast on failure, never a raw error page).
- **Keyboard:** one row in the tab order (roving tabindex); ↑ ↓ PgUp PgDn Home End, Enter
  opens the player.

Shared with Payouts / Reports / Broadcast: `VirtualGrid.tsx` + `grid.css` (generic virtualized
ARIA table), `usePagedRows.ts` (`useQueries` over the shared QueryClient), `model.ts`
(`formatBB`, `ladderBands`, `bandPositions`).

## Contract notes

1. `LeaderboardRowDto` has `tableNumber` but no `tableId`, so the table cell cannot link to the
   table detail. Suggested: add `tableId: string | null`.
2. Finishing-position rows have no elimination time / hand. Suggested: `eliminatedAt` and
   `handId` (the elimination record has both) to link the bust hand to its replay.
3. The standings endpoint has no search; finding one player is done in Players (§2.7).
