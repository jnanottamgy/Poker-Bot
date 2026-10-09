# Players (§2.7)

Every player of the tournament in one server-paginated, virtualized list.

- **Data:** `GET /tournaments/:id/players?q&status&tableId&sort&offset&limit`, pages of
  `PLAYER_PAGE_SIZE` (100). Only the pages covering the rows on screen are requested and
  polled (`PLAYER_POLL_MS`); live tournament events invalidate them (`live/invalidation.ts`).
  `aria-rowcount` is the server `total`, so 8 or 1,000,000 players behave the same.
- **Filters in the URL** (`q`, `status`, `table` + `tn`, `sort`) so a view can be shared and
  survives Back. Search is debounced (300 ms) and runs on the server (name, nickname, public id).
  The table filter is a combobox that asks the server for matching table numbers — never a list
  of all tables.
- **Sort:** the server sorts one way per key — stack (largest first), finishing position,
  name (A–Z), registration order; default = stack once play started, registration before.
- **Bulk approval** (`useBulkApprove`): pending rows loaded on screen can be selected (max
  `BULK_APPROVE_MAX` = 100 per batch); one level-1 confirmation, then one audited request per
  player, paced after a burst of 15 to respect the admin write rate limit (20 burst, 2/s), with a
  bounded retry on `429`. Partial failures are listed per player.
- **Keyboard:** one row is in the tab order (roving tabindex); ↑ ↓ PgUp PgDn Home End move,
  Enter opens the player, Space selects a pending registration.
- **Status is never colour-only:** every status / connection is a pill with icon + text.
- **BB** is truncated to one decimal (`stackInBB`, like `StackDisplay`): never overstated.

Shared with Player detail and Registration: `model.ts` (labels, formatting), `pills.tsx`,
`CredentialCard.tsx` (seat / rejoin card), `print.tsx` (print-only portal), `qr.ts` (join QR as an
`<img>`-safe data URL, join URL), `clipboard.ts`.

## Contract notes

1. `PlayerListItemDto` has no `lastSeenAt`, so the "last seen" column of §2.7 cannot be shown;
   the list shows the registration time instead. Suggested: add `lastSeenAt: number | null`
   (latest session `lastSeenAt`).
2. `status=CONNECTED|DISCONNECTED|AWAY` is answered by the game server by reading up to 100,000
   seated entries and asking every table actor; the UI therefore never polls those counts (the
   chips show a count only once chosen). A connection index on the server would make these cheap.
3. A search (`q`) returns at most 200 matches on the game server (`players.search(…, 200)`).
