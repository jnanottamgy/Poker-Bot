# Admin Control Room — specification

The control room gives tournament staff **complete visibility and complete,
safe control** over every tournament, table, player, clock, payout and audit
record. It is the operational cockpit of Johnny, the algorithmic tournament
director: Johnny runs the tournament automatically; humans watch, intervene
when needed, and every intervention is permission-checked, confirmed and
audit-logged.

Principles

1. **Server-enforced.** Every control calls an admin API that re-checks
   authentication, role permission (`roles.ts`) and tournament scope. The UI
   hiding a button is a convenience, never the security boundary.
2. **No silent changes.** Every override writes an audit entry (who, when,
   what, target, reason, before, after) in the same transaction as the change.
3. **Deterministic effects.** Overrides become director/table inputs in the
   command log, so replays reproduce them exactly.
4. **Scale-aware.** Nothing renders "all players" or "all tables" at once:
   counters, server-side pagination, filters, search and virtualized lists
   (works the same at 8 players or 1,000,000).
5. **Danger levels** (see §4) decide confirmation UX.

## 1. Global frame (every screen)

- **Top bar:** tournament switcher · status pill (FSM state) · live blind clock
  (level, blinds/ante, countdown to next level or break end) · players
  remaining / registered · tables · connection health dot · alerts bell with
  unacknowledged count · **PAUSE AFTER HAND** · **EMERGENCY FREEZE** (red,
  danger level 2) · admin name, role, logout.
- **Left navigation:** Overview · Clock & Structure · Tables · Players ·
  Registration · Hands · Standings · Payouts · Broadcast & Announcements ·
  Fairness · Alerts · Audit Log · System · Reports · Admin Users · Demo &
  Simulation · Settings.
- **Global search** (`/`): player name, nickname, public id (JPN-…), table
  number, hand number.
- **Keyboard:** `g o` overview, `g t` tables, `g p` players, `g h` hands,
  `?` shortcut sheet. Every control reachable by keyboard.
- **Live updates** over the admin WebSocket; a banner shows when the view is
  reconnecting (data greyed out, never shown as live while stale).

## 2. Screens

### 2.1 Tournaments
List (status filter, include simulations toggle, search) · create (wizard) ·
clone config from an existing tournament · open the control room for one ·
delete DRAFT · archive.

### 2.2 Tournament setup wizard (create / edit)
Steps with inline validation (`@jpb/validation`), each error linking to its field:

1. **Basics** — name, join code (auto, editable), scheduled start, auto-start.
2. **Players & tables** — min/max players; table size presets 6-max / 8-max /
   9-max; max seats; final table size; consolidation mode (TARGET/MAX); live
   preview: "N players → T tables (sizes …)".
3. **Chips & blinds** — starting stack; ante type; blind schedule editor
   (add/insert/delete/reorder levels, duration per level), presets STANDARD /
   TURBO / HYPER / SPEED_TEST, "scale to starting stack"; projected duration
   and starting depth in big blinds.
4. **Breaks** — rules (after level N / every N levels, duration, message).
5. **Timing** — action timer, away timer, consecutive timeouts before away,
   network grace, between-hand and showdown delays, start countdown.
6. **Registration** — fields (name/nickname/participant id/email/phone/college
   id: on/off + required), approval required, access code, deadline, late
   registration (until level), re-entry (max entries, until level).
7. **Prizes** — currency, places table, "distribute a pool by percentages"
   helper, notes; validation: positions contiguous, non-increasing, totals.
8. **Spectators, display & features** — public watch, spectator delay,
   eliminated players may watch, feature flags.
9. **Balancing (advanced)** — max imbalance, recent-move window, scoring
   weights (with the documented formula shown).
10. **Review** — full summary, validation result, fairness commitment
    (server seed hash shown once the draft is created) → Save draft / Open
    registration.

After start the configuration is **locked**; only fields in
`MUTABLE_WHILE_RUNNING` (future blind levels, breaks, timers, spectator
settings, feature flags) can change — danger level 2, reason required.

### 2.3 Overview — tournament health
- FSM diagram: current state highlighted; legal transitions as buttons.
- KPI tiles: registered · active · eliminated · in transit · tables (active /
  held / breaking / stalled / closed) · hands completed · hands per minute ·
  actions per second · average hand duration · current level and next level ·
  time to next level/break · elapsed time · **estimated completion** (formula
  documented: from recent elimination rate and remaining players) · average
  and median stack (chips and BB) · chip leader · largest pot.
- **Chip conservation monitor:** expected total vs sum of table chips + chips
  in transit, per check; green ✓ or red CRITICAL with affected tables.
- Charts: players remaining over time · hands/min · action latency p50/p95/p99
  · WebSocket connections by audience · disconnects/reconnects.
- Live feed: eliminations, table moves, table breaks, milestones, admin actions.
- Open alerts.

### 2.4 Clock & structure
Big clock (level, blinds, ante, remaining) with controls: pause (after hand) /
resume, **advance level**, **set level** (level 2 when moving backwards or
skipping), add/remove time (±1 min, ±5 min, custom), start break now
(duration), end break now, hand-for-hand on/off. Upcoming levels table with
projected wall-clock times; inline edit of future levels and breaks (level 2).

### 2.5 Live table map
Virtualized grid/list of table tiles: number, players (n/max), status with
icon + text (ACTIVE, BETWEEN HANDS, HELD (reason), BREAKING, STALLED, FROZEN,
CLOSED), current hand number, seconds since last progress, disconnected
players count, final-table badge. Filters: status, player count range,
stalled only, has disconnected players. Sort: number, players, stall time,
chips. Search by number. Summary bar (counts per status). Server-side
pagination keeps 125,000 tables responsive. Click → table detail.

### 2.6 Table detail (live)
- Visual table: every seat with name, public id, stack (chips + BB), position
  badges (D / SB / BB), status (connected / away / disconnected / suspended /
  in transit), consecutive timeouts, last action, current street contribution.
- Current hand: hand number, phase, board, pot and side pots (eligible seats),
  current bet, acting seat with live countdown, action log for this hand.
- **Hole cards:** hidden by default; "Reveal live hole cards" requires
  `VIEW_HOLE_CARDS`, is danger level 2 and audit-logged.
- Recent hands list → replay. Table stats: hands played, average pot, largest
  pot, average hand duration.
- Internals (debug): table state version, last event seq, owner node, lease
  epoch, last progress time, chip total vs expected, invariant check result,
  raw event log viewer (paginated).
- Controls: hold / release table · freeze / unfreeze table · force timeout of
  the current actor (level 1, reason) · move a player (pick player →
  destination table/seat with the seat-fairness score preview) · rebalance
  now · break this table (level 2) · adjust a stack (level 2, `STACK_ADJUST`) ·
  send a message to this table.

### 2.7 Players
Server-paginated list with search (name, nickname, public id) and filters
(status, table, connected/disconnected, suspended, away, pending approval),
sort (stack, finishing position, name, registration order). Columns: current
stack rank, name, public id, status, table/seat, stack (chips + BB),
connection, consecutive timeouts, last seen. Bulk: approve registrations.

### 2.8 Player detail
- Identity: display name, nickname, public id; personal fields (email, phone,
  participant id, college id) only with `PLAYER_VIEW_PII` — masked otherwise.
- Tournament: status, table/seat (link), stack + BB, current stack rank,
  finishing position (+ ties) and prize, hands played, largest pot won,
  eliminated at / in hand (link to replay).
- Connection: active controller device, all sessions (created, last seen, IP,
  user agent, revoked reason), reconnect count.
- Movement history: every move (from → to, reason, time, score breakdown).
- Recent actions and timeouts.
- Controls: move (level 1) · suspend (sit out; auto-fold) / restore (level 2)
  · disqualify (level 2) · adjust stack (level 2) · revoke all sessions /
  issue a new rejoin code + rejoin QR (level 1) · send a private notice ·
  payout status (if prize).

### 2.9 Registration
Open / close / reopen registration · QR code (full-screen for a projector,
printable poster, copy link) · access code · pending approvals queue (approve
/ reject with reason) · registered list · manual registration by staff (name
→ seat assignment card with rejoin code + QR printed for the player) · counts
vs min/max players · late registration and re-entry status · **Start
tournament** (shows seating preview: N players → T tables).

### 2.10 Hands (history & replay)
Browse/filter hands (table, player, hand number, min pot, showdown, all-in,
time range). Hand detail: dealer/blinds, players with starting stacks, hole
cards (permission), every action chronologically, board by street, pots and
side pots with winners and odd chips, final stacks, randomness metadata.
**Replay**: step PRE-FLOP → FLOP → TURN → RIVER → SHOWDOWN action by action
(play/pause/step), stacks and pot animating. "Verify this hand" link.

### 2.11 Fairness & audit of randomness
Published server seed hash, public entropy (and its inputs), randomness method
(HMAC-SHA256 stream + Fisher–Yates), seed reveal status. **Reveal seed**
(only after COMPLETED/CANCELLED, level 2). Per-hand verification performed
**in the browser** with the portable fairness engine (independent of the
server's answer): SEED COMMITMENT · DECK HASH · HOLE CARDS · BOARD →
VERIFIED / FAILED. Bulk verify (sample or all hands) with progress. Export
the verification bundle (JSON) and step-by-step instructions.

### 2.12 Standings
Two clearly labelled views: **Current stack ranking** (live, paginated) and
**Finishing positions** (elimination order, ties). Prize ladder alongside.
Export CSV.

### 2.13 Payouts
Final positions with configured prizes, payment status workflow
UNPAID → PROCESSING → PAID (processed by, time, payment reference, notes),
totals (configured / paid / outstanding), filters, CSV export for accounting.
Requires `PAYOUT_MANAGE` to change; payment details never visible to players.

### 2.14 Broadcast & announcements
Send an announcement (template or free text) to everyone / a table / one
player / the big screen. Control the broadcast display: featured table,
scene (overview, leaderboard, final table, announcement, champion), milestone
splash. Deterministic commentary templates only (no AI).

### 2.15 Alerts
Open / acknowledged / resolved; severity filter; acknowledge; resolve; jump to
target (table, player). Codes: TABLE_STALLED, CHIP_CONSERVATION_FAILED,
INVARIANT_VIOLATION, PLAYER_CANNOT_ACT, WS_FAILURE_SPIKE, DB_ERROR_SPIKE,
TOURNAMENT_STALLED, ACTION_LATENCY_HIGH, TABLE_CRASHED, WORKER_LOST.

### 2.16 Audit log
Filter by admin, action, target, date range; before/after diff viewer; chain
verification ("Verify chain" → intact / first broken entry); export CSV/JSON.

### 2.17 System
Nodes (id, role, uptime, owned tables, leases), WebSocket connections by
audience, latency p50/p95/p99 (actions, DB, Redis), error rates, stalled
tables, run full integrity check (all invariants on all tables) now.

### 2.18 Reports
Tournament report: id, players, tables used, duration, hands played, average
hand duration, final-table duration, largest pot, winner, final standings,
prize structure, payout status. Export JSON / CSV; print-friendly page (PDF via
the browser).

### 2.19 Admin users
List, create (role, tournament scope), change role, disable/enable, reset
password, active sessions (revoke), role → permission matrix.

### 2.20 Demo & simulation
Create a demo tournament with N deterministic bots (8, 16, 32, 100, 1,000,
10,000 …) and a strategy mix (ALWAYS_FOLD, RANDOM_LEGAL_ACTION, CALL_HEAVY,
RAISE_HEAVY, ALL_IN_RANDOMLY, TIMEOUT_ALWAYS, FLAKY); optional speed mode (only
when the server allows it); watch it live like a real event; results and
throughput numbers.

### 2.21 Settings
Per-tournament feature flags and display options; default sound/haptics for
players.

## 3. Permissions

Every control maps to a permission in `packages/shared-types/src/roles.ts`
(e.g. `TOURNAMENT_PAUSE`, `TOURNAMENT_FREEZE`, `CLOCK_CONTROL`,
`TABLE_CONTROL`, `PLAYER_MOVE`, `PLAYER_SUSPEND`, `PLAYER_DISQUALIFY`,
`STACK_ADJUST`, `VIEW_HOLE_CARDS`, `FAIRNESS_REVEAL_SEED`, `PAYOUT_MANAGE`,
`ADMIN_USERS_MANAGE`, `SIMULATION_RUN`, …). Admins may additionally be
scoped to specific tournaments.

## 4. Danger levels

| Level | UX | Server requirement | Examples |
| --- | --- | --- | --- |
| 0 | none | permission | viewing, searching, exporting |
| 1 | one confirmation dialog | permission (+ reason where noted) | pause after hand, resume, hold/release table, rebalance now, add time, start/end break, move player, approve registration, force timeout, acknowledge alert, new rejoin code |
| 2 | **double confirmation**: type the confirmation word + mandatory reason, consequence summary with before/after preview | permission + non-empty reason | emergency freeze, cancel tournament, disqualify, restore player, set blind level, adjust stack, break table, reveal seed, reveal live hole cards, edit config while running, revoke all sessions |

## 5. Audit entry (every override)

`timestamp · adminId · admin username · action · target · reason · beforeState
· afterState · ip · hash chain`. The audit log is append-only at the database
level and verifiable from the control room.
