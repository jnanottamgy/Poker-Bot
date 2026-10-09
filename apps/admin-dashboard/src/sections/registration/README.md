# Registration (§2.9)

Open / close / reopen, the join QR, approvals, desk registration and the start.

- **State** (`registrationState`): DRAFT → not open; REGISTRATION → open; REGISTRATION_CLOSED →
  closed; STARTING / RUNNING / BREAK / PAUSED → late registration open through the end of
  `lateRegistration.untilLevel` (the director enforces the level), else over.
- **Lifecycle** buttons are enabled from the server's `allowedTransitions`; all level 1 with an
  optional reason. **Start** needs REGISTRATION_CLOSED (normative FSM) and at least
  `max(2, minPlayers)` approved players; the optional admin entropy (≤ 256 chars) is sent as
  `adminEntropy` and explained as a fairness input.
- **Seating preview** "N players → T tables": `tableCount` mirrors `@jpb/seating-engine`
  `computeTableCount` (README "Table count"):
  `n ≤ finalTableSize → 1`, else `max(2, ⌈n / maxSize⌉, min(⌈n / d⌉, ⌊n / minSize⌋))` with
  `d = targetSize` ('TARGET') or `maxSize` ('MAX'); sizes are balanced like `distributeSizes`
  (the first `n mod T` tables get one more). Display only — the server seats players.
- **Pending queue:** `status=PENDING_APPROVAL`, oldest first, 25 per page; approve (level 1,
  bulk via `useBulkApprove`) or reject (level 1, reason required).
- **Registered list:** server-paginated and searchable, segmented by status.
- **QR:** the server SVG is fetched through the API client and shown as a data-URL `<img>`
  (no script can run); projector view (full screen, Esc closes, live count), printable A4 poster
  and the seat card print through `players/print.tsx` (a body-level portal; everything else is
  hidden in print media).
- **Manual registration:** the tournament's configured fields (`name` always first and required,
  server length limits as `maxLength`), light client checks, server field errors mapped back to
  the fields, then the printable seat card (public id, one-time rejoin code, join QR).

## Contract notes

1. The admin API does not expose the public join URL; the UI uses `{page origin}/join/{CODE}`
   (the admin app is served by the game server, whose `PUBLIC_BASE_URL` builds the QR). Suggested:
   add `joinUrl` to `TournamentOverviewDto`.
2. `POST /registrations/manual` also returns `rejoinUrl`, which `ManualRegistrationResponse`
   (src/api/types.ts) does not declare; the card reads it when present.
3. The game server accepts `start` from REGISTRATION (it closes registration itself); the FSM in
   shared-types and the mock require REGISTRATION_CLOSED, so the UI asks to close first.
