# API

REST for request/response, WebSocket (`/ws`) for everything real-time.
Bodies are JSON. Errors are always:

```json
{ "error": { "code": "MACHINE_CODE", "message": "Human friendly sentence.", "details": null } }
```

Authentication is a session cookie (`jpb_ps` player, `jpb_as` admin) —
HttpOnly, SameSite=Lax, Secure in production. Every state-changing request
(POST/PUT/PATCH/DELETE) must send header `x-csrf-token` equal to the
`jpb_csrf` cookie. Admin endpoints check permission (`roles.ts`) and
tournament scope on every call. "L1"/"L2" are danger levels from
[ADMIN_CONTROL_ROOM.md](./ADMIN_CONTROL_ROOM.md); L2 endpoints require
`{ "reason": "…", "confirm": "<WORD>" }` where WORD is given in the table.

Rate limits (per IP and per identity, token bucket): registration 5/min,
login 5 burst then 1/30s, player actions 4 burst then 2/s, admin writes 20
burst then 2/s, admin reads 120 burst then 20/s, public reads 60 burst then
10/s. `429` responses carry `Retry-After`.

## Public (no session)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/public/tournaments/:joinCode` | Join page data: name, status, registration (open, fields, access code required, approval required, deadline), counts, start time, server seed hash, spectator policy |
| POST | `/api/public/tournaments/:joinCode/register` | Register `{ fields…, accessCode?, clientSeed }` → sets player session; returns `{ player, rejoinCode }` (rejoin code shown once) |
| POST | `/api/public/tournaments/:joinCode/rejoin` | `{ publicId, rejoinCode }` → new player session on this device |
| GET | `/api/public/tournaments/:joinCode/summary` | Live public summary (status, clock, counters) |
| GET | `/api/public/tournaments/:joinCode/leaderboard?mode=stack\|finish&offset&limit` | Current stack ranking or finishing positions (clearly labelled) |
| GET | `/api/public/tournaments/:joinCode/fairness` | Seed hash, public entropy inputs, method, revealed seed (after completion) |
| GET | `/api/public/hands/:handId/fairness` | Public fairness record of a hand (hole cards only once the seed is revealed and the feature flag allows) |

## Player (`jpb_ps`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/player/me` | Self summary (status, table/seat, stack, position, prize) |
| GET | `/api/player/history` | Hands played, largest pot, starting/final stack, table movements, finishing position |
| GET | `/api/player/hands?limit` | Own recent hands |
| GET | `/api/player/hands/:handId/fairness` | Fairness record incl. own hole cards (verify in browser) |
| POST | `/api/player/action` | REST fallback of the WS action `{ actionId, type, amount?, tableStateVersion }` |
| POST | `/api/player/logout` | End session on this device |

## Admin (`jpb_as` + CSRF)

Auth: `POST /api/admin/auth/login` · `POST /api/admin/auth/logout` · `GET /api/admin/auth/me`.

Response conventions (DTOs in `packages/shared-types/src/api.ts`; envelopes the
DTO file does not name are typed in `apps/admin-dashboard/src/api/types.ts`):

- Commands answer `{ "ok": true }` unless a result is listed below.
- Paginated lists answer `{ rows, total, offset, limit }` (`Paginated<T>`);
  other lists are wrapped in a named key (`{ tournaments }`, `{ alerts }`,
  `{ entries, nextBeforeSeq }`, `{ users, rolePermissions }`, `{ sessions }`,
  `{ events, nextAfter }`, `{ points }`, `{ seats }`).
- Every level-1 command accepts an optional `reason` (written to the audit log);
  "reason" in a row means it is required.
- Validation errors: `400 INVALID_INPUT` / `INVALID_CONFIG` / `INVALID_FIELDS`
  (`details` lists the issues), `400 REASON_REQUIRED`, `400 CONFIRMATION_REQUIRED`
  (`details.confirmWord`); `401 UNAUTHORIZED`; `403 FORBIDDEN` (permission,
  tournament scope or CSRF); `404 NOT_FOUND`; `409 <CODE>` when the tournament
  director refuses in the current state (e.g. `ILLEGAL_STATE`,
  `HAND_IN_PROGRESS`, `NOT_ELIMINATED`); `429 RATE_LIMITED`.
- CSV exports are `text/csv; charset=utf-8` attachments; the QR is
  `image/svg+xml`.

### Tournaments & lifecycle

| Method | Path | Permission | Level |
| --- | --- | --- | --- |
| GET | `/api/admin/tournaments?status&simulations` | PLAYER_VIEW | 0 |
| POST | `/api/admin/tournaments` `{ config }` | TOURNAMENT_CREATE | 0 |
| GET | `/api/admin/tournaments/:id` (overview: record, director summary, counters, health, chip conservation) | PLAYER_VIEW | 0 |
| PUT | `/api/admin/tournaments/:id/config` (DRAFT/REGISTRATION only) | TOURNAMENT_EDIT_CONFIG | 1 |
| PATCH | `/api/admin/tournaments/:id/config/running` (MUTABLE_WHILE_RUNNING fields) | TOURNAMENT_EDIT_CONFIG | 2 `EDIT` |
| POST | `/api/admin/tournaments/:id/clone` | TOURNAMENT_CREATE | 0 |
| DELETE | `/api/admin/tournaments/:id` (DRAFT only) | TOURNAMENT_CREATE | 1 |
| POST | `/api/admin/tournaments/:id/registration/open` · `/close` · `/reopen` | TOURNAMENT_LIFECYCLE | 1 |
| POST | `/api/admin/tournaments/:id/start` `{ adminEntropy? }` → `{ ok, publicEntropy }` | TOURNAMENT_LIFECYCLE | 1 |
| POST | `/api/admin/tournaments/:id/pause` (after current hands) · `/resume` | TOURNAMENT_PAUSE | 1 |
| POST | `/api/admin/tournaments/:id/freeze` · `/unfreeze` (emergency) | TOURNAMENT_FREEZE | 2 `FREEZE` |
| POST | `/api/admin/tournaments/:id/cancel` | TOURNAMENT_CANCEL | 2 `CANCEL` |

### Clock

| Method | Path | Permission | Level |
| --- | --- | --- | --- |
| POST | `/api/admin/tournaments/:id/clock/advance` | CLOCK_CONTROL | 1 |
| POST | `/api/admin/tournaments/:id/clock/set-level` `{ level }` | CLOCK_CONTROL | 2 `LEVEL` |
| POST | `/api/admin/tournaments/:id/clock/add-time` `{ ms }` (negative allowed) | CLOCK_CONTROL | 1 |
| POST | `/api/admin/tournaments/:id/break/start` `{ durationSeconds }` · `/break/end` | CLOCK_CONTROL | 1 |
| POST | `/api/admin/tournaments/:id/hand-for-hand` `{ enabled }` | TABLE_CONTROL | 1 |

### Tables

| Method | Path | Permission | Level |
| --- | --- | --- | --- |
| GET | `/api/admin/tournaments/:id/tables?status&minPlayers&maxPlayers&stalled&q&sort=number\|players\|stall\|chips&offset&limit` (`q`: table number prefix) | PLAYER_VIEW | 0 |
| GET | `/api/admin/tables/:tableId` (admin view + internals) | PLAYER_VIEW | 0 |
| GET | `/api/admin/tables/:tableId/events?after&limit` | HAND_HISTORY_VIEW | 0 |
| POST | `/api/admin/tables/:tableId/hold` · `/release` | TABLE_CONTROL | 1 |
| POST | `/api/admin/tables/:tableId/freeze` · `/unfreeze` | TABLE_CONTROL | 1 |
| POST | `/api/admin/tables/:tableId/force-timeout` `{ reason, turnVersion? }` (with `turnVersion`, a turn that moved on is never timed out) | TABLE_CONTROL | 1 |
| POST | `/api/admin/tables/:tableId/add-time` `{ ms? }` (extra time for the current actor, 1–600 s, default 30 s) | TABLE_CONTROL | 1 |
| GET | `/api/admin/tables/:tableId/seat-scores?playerId` → `{ seats: SeatScoreDto[] }` (free seats scored for a move) | PLAYER_MOVE | 0 |
| POST | `/api/admin/tables/:tableId/break` | TABLE_CONTROL | 2 `BREAK` |
| POST | `/api/admin/tables/:tableId/reveal-hole-cards` → `{ holeCards }` | VIEW_HOLE_CARDS | 2 `REVEAL` |
| POST | `/api/admin/tournaments/:id/rebalance` → `{ ok, movesPlanned }` (players ordered to another table) | TABLE_CONTROL | 1 |
| POST | `/api/admin/tournaments/:id/integrity-check` → `{ ok, checkedTables, checkedAt, violations, chipConservation }` | TABLE_CONTROL | 0 |

### Players & registration

| Method | Path | Permission | Level |
| --- | --- | --- | --- |
| GET | `/api/admin/tournaments/:id/players?q&status&tableId&sort&offset&limit` | PLAYER_VIEW | 0 |
| GET | `/api/admin/players/:playerId` (detail, sessions, movements) | PLAYER_VIEW | 0 |
| GET | `/api/admin/players/:playerId/pii` (audited) | PLAYER_VIEW_PII | 0 |
| POST | `/api/admin/players/:playerId/move` `{ toTableId, toSeat?, reason }` | PLAYER_MOVE | 1 |
| POST | `/api/admin/players/:playerId/suspend` · `/restore` | PLAYER_SUSPEND | 1 / 2 `RESTORE` |
| POST | `/api/admin/players/:playerId/disqualify` | PLAYER_DISQUALIFY | 2 `DISQUALIFY` |
| POST | `/api/admin/players/:playerId/adjust-stack` `{ newStack }` | STACK_ADJUST | 2 `ADJUST` |
| POST | `/api/admin/players/:playerId/revoke-sessions` → `{ ok, revoked }` | PLAYER_SUSPEND | 2 `REVOKE` |
| POST | `/api/admin/players/:playerId/rejoin-code` (new code) → `{ publicId, rejoinCode, rejoinUrl }`; `rejoinUrl` = `{PUBLIC_BASE_URL}/join/{JOINCODE}#rejoin={publicId}:{rejoinCode}` (for the QR) | PLAYER_SUSPEND | 1 |
| POST | `/api/admin/players/:playerId/notice` `{ text }` | ANNOUNCE | 1 |
| POST | `/api/admin/players/:playerId/approve` · `/reject` | PLAYER_APPROVE_REGISTRATION | 1 |
| POST | `/api/admin/players/:playerId/reenter` (staff re-entry of an eliminated player) → `{ ok, entryId, entryNumber }` | PLAYER_APPROVE_REGISTRATION | 1 |
| POST | `/api/admin/tournaments/:id/registrations/manual` `{ fields }` → `{ player, rejoinCode, rejoinUrl }` | PLAYER_APPROVE_REGISTRATION | 1 |
| GET | `/api/admin/tournaments/:id/qr.svg?size` | PLAYER_VIEW | 0 |

### Hands, fairness, standings, payouts

| Method | Path | Permission | Level |
| --- | --- | --- | --- |
| GET | `/api/admin/tournaments/:id/hands?tableId&playerId&handNumber&minPot&showdown&allIn&offset&limit` | HAND_HISTORY_VIEW | 0 |
| GET | `/api/admin/hands/:handId` (full history incl. hole cards) | HAND_HISTORY_VIEW | 0 |
| GET | `/api/admin/hands/:handId/fairness` | FAIRNESS_VIEW | 0 |
| GET | `/api/admin/tournaments/:id/fairness` · `/fairness/bundle?fromHand&toHand` | FAIRNESS_VIEW | 0 |
| POST | `/api/admin/tournaments/:id/fairness/reveal-seed` (COMPLETED/CANCELLED only) → `{ serverSeed }` | FAIRNESS_REVEAL_SEED | 2 `REVEAL` |
| GET | `/api/admin/tournaments/:id/standings?mode=stack\|finish&offset&limit` · `.csv` | PLAYER_VIEW | 0 |
| GET | `/api/admin/tournaments/:id/payouts` · `/payouts.csv` | PAYOUT_VIEW | 0 |
| PATCH | `/api/admin/entries/:entryId/payment` `{ status, reference, note }` → `{ row: PayoutRowDto }` | PAYOUT_MANAGE | 1 |

### Broadcast, alerts, audit, system, reports, users, demo

| Method | Path | Permission | Level |
| --- | --- | --- | --- |
| POST | `/api/admin/tournaments/:id/announce` `{ text, scope: ALL\|TABLE\|PLAYER\|DISPLAY, targetId? }` | ANNOUNCE | 1 |
| POST | `/api/admin/tournaments/:id/display` `{ scene: OVERVIEW\|LEADERBOARD\|FINAL_TABLE\|ANNOUNCEMENT\|CHAMPION\|FEATURED_TABLE, featuredTableId? }` | ANNOUNCE | 0 |
| GET | `/api/admin/alerts?tournamentId&open&limit` → `{ alerts }` | METRICS_VIEW | 0 |
| POST | `/api/admin/alerts/:id/ack` (→ `{ alert }`) · `/resolve` | ALERTS_MANAGE | 1 |
| GET | `/api/admin/audit?tournamentId&adminId&action&target&beforeSeq&limit` · `/audit.csv` | AUDIT_VIEW | 0 |
| GET | `/api/admin/audit/verify` | AUDIT_VIEW | 0 |
| GET | `/api/admin/system` (nodes, connections, latency, errors) | METRICS_VIEW | 0 |
| GET | `/api/admin/tournaments/:id/metrics/live` (time series for charts) | METRICS_VIEW | 0 |
| GET | `/api/admin/tournaments/:id/report` · `/report.csv` | EXPORT_DATA | 0 |
| GET/POST | `/api/admin/users` (GET → `{ users, rolePermissions }`; POST `{ username, displayName, role, password, tournamentScope }` → `{ user }`) | ADMIN_USERS_MANAGE | 0 / 1 |
| PATCH | `/api/admin/users/:id` (→ `{ user }`) · POST `/api/admin/users/:id/reset-password` `{ password }` | ADMIN_USERS_MANAGE | 2 `USER` |
| GET | `/api/admin/sessions` (→ `{ sessions }`) · POST `/api/admin/sessions/:id/revoke` `{ reason }` | ADMIN_USERS_MANAGE | 0 / 1 |
| POST | `/api/admin/demo` `{ players, strategyMix, speedMode, name? }` · GET `/api/admin/demo/:id` · POST `/api/admin/demo/:id/stop` (each → `DemoStatusDto`) | SIMULATION_RUN | 0 |

## WebSocket `/ws`

One socket per app. Types: `packages/shared-types/src/protocol.ts`.

```
client → hello { v, audience: PLAYER|SPECTATOR|ADMIN|DISPLAY, tournamentId, resume }
server → welcome → snapshot (authoritative)
server → table_update { events (filtered for you), view (your audience) }   per processed table command
server → tournament_event { event, summary }
server → self_update | notice | another_device | session_replaced | action_result | pong | error
client → action { actionId, tableId, type, amount?, tableStateVersion } | ping | takeover | watch | snapshot_request
```

- PLAYER requires the player cookie; only one **controller** socket per player
  (a second one receives `another_device` and may send `takeover`; the old
  one then receives `session_replaced`).
- ADMIN requires the admin cookie; may `watch` any table of a tournament in
  scope (hole cards only with `VIEW_HOLE_CARDS` after an audited reveal).
- SPECTATOR is allowed when the tournament permits public watching or the
  player has been eliminated and spectators are enabled; spectator frames are
  delayed by `spectators.delaySeconds` and never contain hole cards.
- DISPLAY is the broadcast screen (public data only).
