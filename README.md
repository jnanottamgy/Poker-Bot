# Johnny's Poker Bot

A deterministic, auditable, horizontally scalable **No-Limit Texas Hold'em
tournament operating system**. Players scan one QR code, enter their name, and
their phone becomes their poker table. Johnny — the algorithmic tournament
director — deals, runs the blinds and the clock, pots and side pots, timers,
eliminations, table balancing, hand-for-hand and the final table without a
human dealer. Staff watch and intervene from an admin control room; a big
screen shows the event.

> **Player count is data, not architecture.** The same code runs a 2-player
> game and is designed to distribute a 1,000,000-player field across 125,000
> tables. Capacity claims are only made where load tests prove them
> ([docs/TESTING.md](docs/TESTING.md)).

> **No AI in game logic.** Cards come from a committed server seed through
> HMAC-SHA256 and Fisher–Yates; every decision is a deterministic rule. See
> [docs/NO_AI.md](docs/NO_AI.md) and [docs/FAIRNESS.md](docs/FAIRNESS.md).

## What you get

- **Player app** (`/`) — QR join, registration, rejoin code for a second
  device, lobby, live table with timers and legal actions only, table moves,
  breaks, elimination and champion screens, spectating, hand history and
  in-browser fairness verification. Mobile first; survives refreshes, locked
  phones and network drops.
- **Admin control room** (`/admin/`) — 21 screens: overview with live KPIs and
  chip-conservation monitor, blind clock and structure editing, live table map
  and table detail (seats, hand, internals, raw event log), players and
  sessions, registration with QR and manual sign-up, hands with replay,
  fairness (seed reveal and bulk verification), standings, payouts, broadcast
  control, alerts, hash-chained audit log, system health, reports, admin
  users, demo mode with bots, settings. Every control is permission-checked,
  confirmed according to its danger level and audit-logged.
- **Broadcast display** (`/display/`) — projector / TV / OBS view: blind clock,
  featured table, leaderboard, final table, announcements, champion.
- **Game server** — event-sourced table actors and Johnny on PostgreSQL, a
  durable outbox between them, WebSocket gateway, REST API, crash recovery by
  log replay, multi-node failover with Redis leases.

## Run it (zero cost)

```bash
node scripts/setup-env.mjs            # once: .env with strong random secrets + admin password
docker compose up -d --build          # app + PostgreSQL + hourly backups
open http://localhost:8080/admin/     # log in with the admin password printed by step 1
```

Venue Wi-Fi, a free public HTTPS tunnel and a free cloud VM are described in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The event-day runbook is
[docs/RUNBOOK.md](docs/RUNBOOK.md). To see everything working without
players, use **Demo & Simulation** in the control room (8 to 10,000 bots).

## Develop

```bash
npm ci
# PostgreSQL is required (docker compose up -d postgres, or a local server)
export DATABASE_URL=postgres://jpb:jpb@localhost:5432/jpb
export BOOTSTRAP_ADMIN_USERNAME=admin BOOTSTRAP_ADMIN_PASSWORD='a long dev password'
npm run dev -w @jpb/game-server          # API + WebSocket on :8080
npm run dev -w @jpb/player-web           # :5173  (proxies /api and /ws to :8080)
npm run dev -w @jpb/admin-dashboard      # :5174
npm run dev -w @jpb/broadcast-display    # :5175
# UI without a server: npx vite --mode mock inside apps/player-web or apps/admin-dashboard

npm run check                            # typecheck + lint + every test
```

## Repository layout

```
apps/        player-web · admin-dashboard · broadcast-display
services/    game-server (REST API, WebSocket gateway, actor runtime, Johnny + tables, persistence)
packages/    shared-types · randomness · fairness-engine · poker-engine · table-engine ·
             seating-engine · balancing-engine · tournament-engine · validation ·
             simulation · client-sdk · ui
infra/       docker · monitoring (Prometheus + Grafana)
tests/       property · integration · e2e · chaos · load
docs/        contracts, architecture, API, control room, fairness, seating, security,
             testing, deployment, runbook, legal
```

## Documentation

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Actors, event sourcing, durable outbox, failover, scaling path |
| [CONTRACTS.md](docs/CONTRACTS.md) | Normative rules and interfaces between packages |
| [API.md](docs/API.md) | Every REST endpoint and the WebSocket protocol |
| [ADMIN_CONTROL_ROOM.md](docs/ADMIN_CONTROL_ROOM.md) | Every admin screen, permission and danger level |
| [FAIRNESS.md](docs/FAIRNESS.md) | Commit–reveal, deck derivation, independent verification |
| [SEATING_AND_BALANCING.md](docs/SEATING_AND_BALANCING.md) | Seating, balancing and final-table rules |
| [SECURITY.md](docs/SECURITY.md) | Threat model, sessions, CSRF, RBAC, audit chain |
| [TESTING.md](docs/TESTING.md) | Test layers, chaos and load tests, measured results |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Zero-cost deployment options and operations |
| [RUNBOOK.md](docs/RUNBOOK.md) | What staff do on event day |
| [LEGAL.md](docs/LEGAL.md) | Virtual chips only; jurisdiction notes |

Everything here is free and open source to run: Node.js, PostgreSQL and
(optionally, for multi-node) Redis. No paid services are required.
