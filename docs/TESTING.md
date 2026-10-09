# Testing

Every layer is tested on its own and then together, up to complete
tournaments over the real HTTP and WebSocket interfaces, crashes, database
outages and node failures. Nothing in a test uses AI; bots are fixed rules
plus seeded randomness.

## Running the tests

```bash
npm ci
npm run typecheck && npm run lint

# Unit + property + package tests (no services needed)
npx vitest run --project packages --project ui --project property

# Everything, including PostgreSQL / Redis backed tests
export TEST_DATABASE_URL=postgres://jpb:jpb@localhost:5432/jpb_test
export TEST_REDIS_URL=redis://localhost:6379
npm test
```

Tests that need PostgreSQL or Redis skip themselves when the variables are
not set. Each test file uses its own schema, so files run in parallel against
one database. CI (`.github/workflows/ci.yml`) runs everything with PostgreSQL
16 and Redis 7 service containers.

## Layers

| Layer | Where | What it proves |
| --- | --- | --- |
| Poker rules | `packages/poker-engine/test` | Betting, side pots, odd chips, showdown evaluation, every rule of the spec, incl. property tests over random hands |
| Table actor | `packages/table-engine/test` | Dead-button blinds, timers with grace, freezes, holds, suspension, idempotency, stale actions, chip conservation invariants |
| Randomness & fairness | `packages/randomness/test`, `packages/fairness-engine/test` | Unbiased integers, Fisher–Yates, HMAC streams, commitments, published-vector compatibility, independent verification |
| Seating & balancing | `packages/seating-engine/test`, `packages/balancing-engine/test` | Initial seating, balancing moves, final-table formation, seat fairness scores |
| Johnny (director) | `packages/simulation/test` | Complete tournaments from 2 to 1,000 players through the real engines; determinism (same seed → identical digest); every actor rebuilt from its own log equals the live state; **asynchronous delivery** with random per-link latency (up to 5 s) reproducing production races |
| Validation | `packages/validation/test` | Every configuration rule and every API / WebSocket input |
| Actor runtime | `services/game-server/test/runtime-*.test.ts` | Mailboxes, transactions, fencing, leases, timers, recovery with determinism checks, routing across nodes, failover with Redis |
| Gateway | `services/game-server/test/gateway-*.test.ts` | Authentication on upgrade, audiences, privacy of hole cards, controller takeover, spectator delay, slow consumers |
| Game runtime | `services/game-server/test/game-runtime.test.ts` | Tournaments on PostgreSQL through the durable outbox; every hand verified against the revealed seed; restarts mid-tournament |
| End to end | `services/game-server/test/e2e-http.test.ts` | Admin login, CSRF, create, register, WebSocket play to a champion, payouts, CSV, hand history, report, seed reveal, public verification, audit chain |
| Admin API contract | `tests/integration/admin-api-contract.test.ts` | The admin control room's own typed client against the real server: every registry endpoint answered with exactly the client type's fields; the registry and docs/API.md list the same endpoints and permissions |
| Player in a browser | `tests/e2e/player-browser.test.ts` | A phone browser joins, registers, plays an action, survives a reload and hands over to a second device with the rejoin code |
| Johnny under load | `services/game-server/test/director-actor.test.ts` | Table reports coalesced into one director command behave exactly like the same reports one by one; re-delivery never applies one twice |
| Chaos | `tests/chaos` | Process crash + restart; PostgreSQL backends killed repeatedly; injected database latency; a 5 s Redis outage under a two-node cluster; a cluster losing the node that hosts Johnny |
| Load | `tests/load` | Real HTTP registrations and one WebSocket per player; latency percentiles and throughput |
| UI | `packages/ui/test`, `apps/*/test` | Components, formatting, screens (jsdom) |

## Chaos tests

`tests/chaos` boots complete servers in-process (`buildServer`):

- **restart** — the process dies like `kill -9` (sockets dropped, no final
  snapshot), a new process starts on the same database, players reconnect,
  and the tournament finishes with chip conservation green and no alert.
- **database outage** — every PostgreSQL backend of the server is terminated
  four times during play. Commands in flight fail or are reconciled from the
  log; nothing is applied twice and nothing is lost.
- **slow database** — every PostgreSQL round trip is delayed 20–120 ms for
  12 seconds mid-play: play slows down, nothing breaks, the tournament
  finishes with chips conserved.
- **Redis outage** — two nodes reach Redis through a TCP proxy that is cut for
  5 seconds. No node may keep processing on a lease it cannot renew, so every
  actor stops (never two owners); when Redis returns the cluster re-acquires
  the leases, recovers from the logs, re-arms timers and finishes.
- **failover** — two nodes share PostgreSQL and Redis; the node hosting the
  director is killed. The survivor waits for the leases to expire, recovers
  Johnny and the tables from their logs (with the determinism check on),
  re-arms timers, delivers the dead node's pending outbox messages, accepts
  the reconnecting players and finishes the tournament.

Simulation with shove-heavy bots (whole tables busting in one hand) found a
liveness bug: a field that dropped straight onto the bubble could end with
the last players alone at separate tables. It is fixed, the stalled seeds
are regression tests, and a property test runs 150 such fields per run.

These tests found two real bugs that are now fixed: a shutdown that hung
forever while clients kept reconnecting (late WebSocket upgrades were never
destroyed), and a race the simulator now reproduces (a move ordered while
the player busts at the source table raised a false integrity alert).

## Load testing

```bash
# Server: allow the registration burst (rate limits are fixed in production)
NODE_ENV=development RATE_LIMIT_SCALE=1000 UV_THREADPOOL_SIZE=16 npm start -w @jpb/game-server

# Load generator (another terminal or machine)
npm run load -w @jpb/tests -- --base http://localhost:8080 --admin admin:<password> --players 1000
```

Options: `--players N`, `--concurrency N` (registration / connection ramp),
`--think 200-1200` (bot think time in ms), `--no-speed` (normal blinds),
`--max-minutes 30`, `--json`.

The generator registers every player through the public API (rejoin code
hashing included), opens one WebSocket per player, starts the tournament as
admin and plays until a champion is crowned, reporting registration,
connect-to-snapshot and action round-trip percentiles, actions/s, frames/s
and errors. Exit code 0 only when the tournament completed without errors.

The first load runs found two real capacity bugs, both fixed: duplicate
registration numbers under concurrent registrations (two writers shared one
counter), and libuv thread-pool starvation by password hashing that made even
database connections time out.

### Measured results

Results from the development container (4 vCPU, 15 GB RAM; the load
generator, PostgreSQL and the server on the same machine — a pessimistic
setup). Run the load test on your own hardware before an event; never assume
these numbers.

**1,000 players** (125 tables, speed blinds, bots thinking 0.2–1.2 s, one
WebSocket each; `--players 1000 --concurrency 60 --think 200-1200`):

| Measure | First run | After the fan-out fix |
| --- | --- | --- |
| Result | completed, 904 hands in 240 s | completed, 860 hands in 237 s |
| Errors / unexpected disconnects | 0 / 0 | 0 / 0 |
| Registration (incl. rejoin-code hashing), p50 / p95 | 1.3 s / 2.0 s | 1.0 s / 1.9 s |
| Connect → authoritative snapshot, p50 / p95 / p99 | 97 / 120 / 145 ms | 79 / 100 / 124 ms |
| Action round trip (send → durable ack), p50 / p95 / p99 | 16 / 93 / 199 ms | **6 / 28 / 76 ms** |
| Frames sent to players | 2.6 million (≈ 4 GB) | 463 thousand (≈ 850 MB) |

The first run showed every tournament-wide event (each elimination, move and
registration) being pushed to every phone — quadratic in the field size. In
fields above 300 players, players and spectators now get one coalesced
summary per second instead (admins and the big screen keep the full feed).

Registration latency is dominated by the deliberately slow, memory-hard
hashing of each player's rejoin code, queued so it never starves the server.

## Simulation

```bash
# Many complete tournaments through the real engines (no I/O), optionally with asynchronous delivery
npx tsx packages/simulation/scripts/sweep.ts 2,9,10,100,1000 5 default
npx tsx packages/simulation/scripts/sweep.ts 10,100,300 3 aggro 100-5000   # 0.1–5 s link latency
```

Earlier runs: 236 simulated tournaments from 2 to 200 players and four
strategy mixes, a 1,000-player tournament (126 tables) in about 3 s and a
10,000-player tournament (1,251 tables, 3,925 hands) in 80 s — all with zero
integrity alerts. The admin control room's **Demo & Simulation** screen runs
the same bots through the real runtime and network stack.
