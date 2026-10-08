# Architecture

Johnny's Poker Bot is a **server-authoritative, event-sourced, actor-based**
tournament system. The same code path runs a 2-player game on a laptop and is
designed to distribute a 1,000,000-player field over many machines.

> Player count is data, not architecture. Scale changes how many processes run
> the actors — never the actors themselves.

## 1. Layers

```
                    CDN (static player/admin/display bundles; never private state)
                                     │
                               Load balancer
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
   GATEWAY node                 GATEWAY node                 GATEWAY node      (NODE_ROLE=gateway)
   REST API + WebSockets        REST API + WebSockets        REST API + WebSockets
   auth · rate limits · per-audience serialization · fan-out
        │                            │                            │
        └────────────── Redis (pub/sub bus · leases · shared rate limits) ───────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
   WORKER node                  WORKER node                ORCHESTRATOR node   (NODE_ROLE=worker / orchestrator)
   table actors 1..N            table actors N+1..M        Johnny (director actor per tournament)
        │                            │                            │
        └──────────────────── PostgreSQL (command logs · snapshots · projections) ┘
```

A single node (`NODE_ROLE=all`, the default) runs every role in one process with
an in-process bus and needs only PostgreSQL. This is the recommended setup for
events up to a few thousand players and costs nothing beyond one machine.

## 2. Pure cores, impure shells

| Package | Role | Purity |
| --- | --- | --- |
| `@jpb/poker-engine` | one hand of NLHE | pure |
| `@jpb/table-engine` | one table across hands (actor reducer) | pure |
| `@jpb/tournament-engine` | Johnny, the director (actor reducer) | pure |
| `@jpb/seating-engine`, `@jpb/balancing-engine` | seating & balancing math | pure |
| `@jpb/fairness-engine`, `@jpb/randomness` | decks, commitments, verification | pure (+ CSPRNG entry) |
| `services/game-server` | I/O: persistence, timers, sockets, auth | impure shell |

Every game decision is made inside a pure reducer:

```
(state, command, ctx) → { state', events[], timers[] | effects[], reply }
```

`ctx` supplies the only external inputs: the time the command was processed
(`at`, recorded in the log) and deterministic randomness derived from the
committed server seed. Therefore **replaying the command log reproduces the
exact state and the exact event stream** — this is the basis of crash
recovery, hand replay, debugging and audit (spec §66, §103, §104).

## 3. The actor model

- **Table actor** — one per table. Processes `TableCommandEnvelope`s strictly
  sequentially: player actions, timers, seat/remove, holds, freezes. Race
  conditions such as "CALL and RAISE arrive together" are impossible by
  construction: the first is applied, the second is rejected as no longer
  legal (or as a duplicate if it carries the same `actionId`).
- **Director actor (Johnny)** — one per tournament. Consumes table reports
  (`HAND_RESULT`, `PLAYER_REMOVED`, `TABLE_STATUS_CHANGED`), clock ticks and
  admin overrides; emits table commands (moves, blinds, holds), notifications
  and tournament events.
- Actors never share memory. They communicate only through messages routed by
  the host (in-process queue on one node, Redis channels across nodes).

### Ownership and failover

Each actor is owned by exactly one node via a **lease** (Redis `SET PX` +
compare-and-set Lua, or the in-memory manager on a single node). The lease
carries a monotonically increasing **epoch** (fencing token). A node that
cannot renew a lease stops the actor immediately. A second line of defence is
the command log's primary key `(table_id, seq)`: a stale owner attempting to
append a command with an already-used sequence number fails the insert and
halts.

When a node dies, its leases expire; another node acquires them, loads the
latest snapshot, replays the commands after it, re-derives timers from the
recovered state (deadlines are absolute server times stored in state) and
continues. Players see a short "reconnecting" state; their chips, seat and the
hand in progress are unchanged.

## 4. Command processing pipeline (one table)

```
PlayerActionSubmitted  (WS frame / REST)
  → gateway: authenticate session, rate-limit, schema-validate, attach playerId
  → route to table owner (bus channel table:{id}:cmd)
  → actor queue (FIFO)
  → stamp envelope { commandId, seq, at = now() }
  → reduceTable(state, envelope, ctx)              ActionValidated / ActionApplied
  → BEGIN
      INSERT table_commands (table_id, seq, ...)   -- idempotency: UNIQUE(table_id, action_id)
      INSERT table_events ...
      UPDATE projections (hands, actions, seats, tournament_players ...)
      every N commands: INSERT table_snapshots
    COMMIT                                          GameStateChanged (durable)
  → publish events (table:{id}:events)              EventPublished
  → gateways filter per audience and push frames    ClientsUpdated
  → reply to the submitting client (action_result)
```

If the transaction fails, the in-memory state is **not** advanced (the actor
keeps the previous state and the client receives an error); nothing is
published. Nothing is ever partially applied (spec §63).

## 5. Time

- All deadlines are absolute server epoch milliseconds stored in state.
- The host owns real timers; reducers only *request* them. A fired timer is
  just another command (`TIMER_FIRED` with a token); stale tokens are no-ops.
- A player action is accepted while `at <= deadline + actionGraceMs`. The
  client countdown is cosmetic and uses a clock offset estimated from
  ping/pong round trips, so network latency never costs a player their action
  (spec §16–18).
- Blind levels change on the director's clock and apply to each table from
  its next hand; a hand in progress is never interrupted (spec §44).

## 6. Data model

PostgreSQL is the source of truth (see `services/game-server/migrations`).

- **Command logs** (`table_commands`, `director_inputs`) + **snapshots**
  (`table_snapshots`, `director_snapshots`) are authoritative.
- **Event logs** (`table_events`, `tournament_events`) feed reconnecting
  clients and audits.
- **Projections** (`hands`, `hand_players`, `actions`, `pots`, `pot_winners`,
  `eliminations`, `player_movements`, `seats`, `tournament_players`, counters on
  `tournaments`) make admin queries fast without scanning logs.
- `audit_logs` is append-only (database trigger) and hash-chained.
- Server seeds are stored AES-256-GCM encrypted (`SEED_ENCRYPTION_KEY`), revealed
  only after the tournament ends.

Redis holds only ephemeral data (pub/sub, leases, shared rate-limit buckets,
presence). Losing Redis degrades real-time fan-out until it returns; it never
loses game state.

## 7. Real-time protocol

WebSocket JSON frames (types in `packages/shared-types/src/protocol.ts`).

- On connect the client authenticates (session cookie), sends `hello` with a
  resume cursor, and receives an **authoritative snapshot** (spec §114).
- Afterwards it receives compact **events** (gap-free per-table `seq`). A gap,
  a version mismatch or any doubt → the client requests a snapshot. Server
  state always wins (spec §76).
- Private events (`HOLE_CARDS_DEALT`) are delivered only to their owner's
  sockets. Spectator streams never contain hole cards except those shown at
  showdown, and may be delayed (`spectators.delaySeconds`).
- One active **controller** connection per player; a second device gets
  `another_device` and may take over, which sends `session_replaced` to the
  old one (spec §70). Spectating is a separate audience.

## 8. Security model

The browser is hostile. Clients can only express intentions; every intention
is re-validated by the reducer that owns the state. Sessions are random
256-bit bearer tokens stored as SHA-256 hashes, delivered in `HttpOnly`,
`SameSite=Lax`, `Secure` cookies. State-changing HTTP requests require a CSRF
token header. Admin APIs check authentication, role permission (RBAC,
`packages/shared-types/src/roles.ts`) and tournament scope on every request.
Dangerous overrides require a reason and are audit-logged with before/after
state.

## 9. Scaling path

| Field | Tables | Suggested deployment |
| --- | --- | --- |
| 2 – 2,000 | 1 – 250 | 1 node (`all`) + PostgreSQL |
| 2,000 – 50,000 | 250 – 6,250 | 2+ gateways, 2+ workers, 1 orchestrator, Redis, PostgreSQL with a pooler |
| 50,000 – 1,000,000 | 6,250 – 125,000 | gateway and worker pools sized by load tests; PostgreSQL partitioned by tournament/table, read replicas for admin queries; orchestrator shards by table range (director per region + top-level balancer) |

Capacity numbers are only claimed where `tests/load` measured them; see
`docs/LOAD_TESTING.md`.
