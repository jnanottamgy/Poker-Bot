# Actor runtime

Generic, poker-agnostic runtime that hosts **actors**: single-threaded,
event-sourced state machines (table actors, the tournament director, test
actors). The same actor code runs unchanged on one node (`NODE_ROLE=all`,
in-memory bus/leases/membership) and on a cluster of gateway / worker /
orchestrator nodes (Redis bus, Redis leases, Redis membership). PostgreSQL is
the source of truth in both cases.

```
            submit(kind, id, cmd)
                    │
              ActorRouter ──── not here ──▶ bus RPC ──▶ owner's ActorHost
                    │ here (or placed here → activate on demand)
                    ▼
  ActorHost ─ mailbox (FIFO per actor) ─ step (pure) ─ ONE transaction ─ COMMIT ─▶ state', timers, outbox, reply
     │                                               (log + events + projection + snapshot)
     ├─ TimerService (one min-heap + one clock timer for all actors)
     ├─ LeaseManager (ownership + fencing epoch; renewed by one loop)
     └─ ActorLog (Postgres: table_* / director_* ; in-memory for unit tests)
  NodeRuntime = Membership + LeaseManager + ActorHost + TimerService + ActorRouter (+ rebalancing)
```

## Files

| File | Purpose |
| --- | --- |
| `actor.ts` | `ActorDefinition<S, C, R, M>`, `StepResult`, envelope, helpers (`stepResult`, `noopResult`, `checkStepResult`), default channels/pools |
| `canonical.ts` | `canonicalCopy`: JSON deep copy with sorted object keys (commands live and on replay) |
| `actor-host.ts` | `ActorHost`: mailboxes, commit pipeline, faults, fencing, lease renewal, timers, remote request handling, stats/metrics |
| `actor-log.ts` | `ActorLog` interface + `MemoryActorLog` |
| `pg-actor-log.ts` | `PostgresTableLog` (table_commands/table_events/table_snapshots + `tables` row), `PostgresDirectorLog` (director_inputs/tournament_events/director_snapshots) |
| `transactions.ts` | `TransactionRunner` (`storeTransactions(store)`, `memoryTransactions()` with failure injection) |
| `recovery.ts` | `recoverActor`: snapshot (or a given start state) + replay up to an optional seq, optional determinism check; `replayOne` |
| `timer-service.ts` | keyed timers on a binary min-heap with lazy deletion |
| `clock.ts` | `Clock`, `systemClock`, `ManualClock` (tests) |
| `membership.ts` | `Membership` heartbeat: `MemoryMembership`, `RedisMembership` |
| `placement.ts` | weighted rendezvous hashing, role → pool mapping |
| `router.ts` | `ActorRouter`: local fast path, on-demand activation, bus RPC |
| `rpc.ts` | RPC wire types and channel names |
| `node-runtime.ts` | `NodeRuntime` facade, `createNodeRuntime(env, deps)`, `ActorCatalog` |
| `lease.ts` | `LeaseManager` (`MemoryLeaseManager`, `RedisLeaseManager`) |
| `errors.ts` | `ActorRuntimeError` codes, `DeterminismError`, `ReplayStepError` |

## Writing an actor

```ts
const def: ActorDefinition<State, Command, Reply, TableLogMeta> = {
  kind: 'table',                 // pool defaults: director → orchestrator, others → worker
  snapshotEvery: env.snapshotEveryCommands,
  initialState: (id) => ...,     // state before seq 1 when there is no snapshot
  step: (state, { actorId, seq, commandId, at, command }) => stepResult(next, reply, { events, timers, cancelTimers, outbox, projection }),
  commandType: (c) => c.type,    // `type` column of the log
  actionIdOf: (c) => c.actionId ?? null,   // idempotency column
  timerCommand: (key, token) => ({ type: 'TIMER_FIRED', kind: key, token }),
  pendingTimers: (state) => [...],         // timers to re-arm after recovery
  logMeta: (state) => ({ status, playerCount, handsPlayed, progressed }), // PostgresTableLog needs it
  versionOf: (state) => state.version,     // optional; recorded with snapshots
  eventSeqOf: (state) => state.lastEventSeq, // optional; enables gap-free event enforcement
};
node.host.register({ definition: def, log: new PostgresTableLog(store.repos) });   // or NodeRuntime({ kinds: [...] })
```

Rules for `step` (enforced by tests and, where possible, by the host):

- **Pure and deterministic.** Time only from `envelope.at`; randomness only
  derived from state/envelope; never mutate `state` or `command`.
- **Duplicates / rejections without effect return `noopResult(state, reply)`.**
  Nothing is persisted and `state` is discarded; a noop carrying events,
  timers, outbox messages or a projection faults the actor.
- **Events** carry their own per-actor `seq`; with `eventSeqOf` the host
  requires `first = eventSeqOf(state) + 1`, consecutive seqs, and
  `eventSeqOf(next) = last`.
- **Timers** are `{ key, at (absolute ms), token }`; one per key (a new one
  replaces the old). The fired command is `timerCommand(key, token)`; `step`
  must ignore stale tokens. Deadlines live in state so `pendingTimers` can
  re-arm them after recovery.
- **Commands and state are plain JSON.** The host deep-copies every command
  through JSON **with object keys sorted** (`canonicalCopy`) before `step`,
  and recovery canonicalizes each command read back from the log the same
  way. JSONB reorders keys (shorter first, then bytewise), so without this a
  reducer that iterates a command's keys would behave differently on replay.
  Reducers therefore see command keys in sorted order, whatever order the
  submitter used. State keeps the reducer's own insertion order: snapshots
  are stored order-preserving (see Contract notes).

## Processing pipeline (per command)

1. Commands for one actor are processed strictly one at a time from a FIFO
   mailbox (bounded, default 10,000 → `UNAVAILABLE`); different actors run
   concurrently.
   A command still queued when its submitter's deadline passes (the
   router's `timeoutMs`, passed as an `AbortSignal`) is withdrawn:
   `UNAVAILABLE`, `processed: 'no'`; one already in flight answers
   `UNAVAILABLE`, `processed: 'unknown'`.
2. The lease must be locally valid, judged on the **monotonic** clock
   (`monotonic() < requestSentAt + ttl - safety`; a wall-clock step never
   extends it), otherwise the actor stops (`NOT_OWNER`).
   If the previous unit of work failed ambiguously, the log is checked first
   (see Failure modes).
3. Envelope: `seq = lastSeq + 1`, `commandId` = the routed request's
   correlationId (or `randomUUID()` for a local submit),
   `at = max(clock.now(), lastAt)` (never decreases even if the wall clock steps back).
4. `step` (pure). Throws / invalid result (`checkStepResult`) → **FAULTED** (see below).
5. One unit of work: `log.append` (command + events [+ `tables` meta]) →
   `projection(repos)` → snapshot when `seq % snapshotEvery === 0`, bounded
   by `commitTimeoutMs` (default 30 s; a black-holed connection must not
   wedge the mailbox forever).
6. Only after COMMIT: in-memory state replaced, timers cancelled/scheduled,
   outbox published (in order, not awaited), reply resolved.

Metrics (via `MetricsCatalog`): `jpb_command_latency_ms{kind}`,
`jpb_db_latency_ms` (+ `windows.dbLatency`), `jpb_db_errors_total{area="actor"}`,
`jpb_errors_total{area="actor_fault"|"bus_publish"}`,
`jpb_integrity_violations_total{code="ACTOR_FAULT"|"ACTOR_FENCED"}`, and the
new gauge `jpb_actors_hosted{kind,status}`. `host.stats()` / `node.stats()`
give per-actor status, seq, queue length, last progress, last latency, lease
epoch/expiry, last snapshot seq, armed timers and `reconciling` (an
ambiguous commit is being settled; commands wait) for the admin internals view.

## Guarantees

- **Durable before acknowledged.** A reply, a state change, a timer change or
  a bus publication happens only after the transaction that logged the
  command committed.
- **Exactly-once processing per committed command.** Each committed command
  has a unique gap-free `(actor, seq)`; replay applies every committed command
  exactly once and nothing else (noops and failed transactions are never
  logged). Idempotency across client retries comes from `actionIdOf`
  (actor-level memory of processed ids + `UNIQUE (table_id, action_id)`).
  A routed request is applied at most once even across an ownership change,
  with or without an idempotency key (see Routing).
- **Live state never runs behind the log.** After an ambiguous unit of work
  the actor answers nothing (not even a noop) until it has checked the log
  and, if the command committed, caught up from it.
- **At-most-once publication.** Outbox messages are published once after
  commit and never re-published by recovery. A lost message is repaired by
  clients requesting an authoritative snapshot (bus contract).
- **Single writer per actor.** Leases make one node the owner; the
  `(actor, seq)` primary key fences a stale owner that still writes. The
  lease epoch identifies the lease generation (increasing, also across Redis
  data loss: it is seeded from the Redis server time in µs) but is not the
  fencing mechanism.
- **Determinism.** Recovery replays with the recorded `seq/commandId/at`; the
  optional determinism check compares replayed events with the logged ones.

## Failure modes

| Failure | Behaviour | Reply to the caller |
| --- | --- | --- |
| `step` throws, or returns an invalid result | Nothing persisted, state stays at the last committed version, queued commands rejected, timers cancelled, `onFault` fires (raise a CRITICAL alert). The actor keeps its lease so no other node re-runs the poison command. `resetFaulted` restarts it from the log. | `FAULTED` (not retryable) |
| Transaction fails (DB down, SQL error, projection error) or exceeds `commitTimeoutMs` | State, timers, outbox untouched. Before the next command (or right away when the mailbox is empty) the host reads the log at seq + 1: absent → continue with the same seq; unreachable → the mailbox pauses and the check is retried every `reconcileRetryMs` (callers' deadlines still apply). | `PERSISTENCE_FAILED`, retryable, `processed: 'unknown'` (a failure reported on COMMIT can hide a commit) |
| Ambiguous commit (COMMIT succeeded, error reported) | The check above finds seq + 1: the actor replays the log from its current state (`recoverActor({ from })`), cancels and re-arms timers from the new state, and continues on the same node. The command's outbox messages are lost (at-most-once). A command that committed after its timeout and after the check meets `DuplicateSequenceError` on the next append → fencing path below. | as above; later commands see the committed command |
| `DuplicateSequenceError` and our seq exists in the log | Another owner wrote it: the actor is deactivated here (lease released best-effort; CAS so it never releases someone else's). | `FENCED` (retryable: the router re-resolves the owner) |
| `DuplicateSequenceError` but our seq is free | The idempotency key (action id) already exists in the DB. Actor continues. | `CONFLICT` |
| Lease renewal refused | Actor stops immediately: queued commands rejected, timers cancelled, unsubscribed. A command already inside its transaction may still commit (fencing protects the new owner). | `NOT_OWNER` |
| Lease renewal errors (Redis unreachable) | Retried each period; every command checks local validity on the monotonic clock, so processing stops before the lease can expire (`leaseSafetyMs`, default ttl/5) even if the wall clock steps backwards. | `NOT_OWNER` |
| PostgreSQL connection dies (restart, failover, idle kill) | `Database` listens for pg's `'error'` on the pool and on checked-out clients (an unlistened `'error'` would crash the process); a broken client is destroyed, not pooled. The command in flight fails as above. | `PERSISTENCE_FAILED` |
| Submitter's deadline passes | Queued: withdrawn. In flight: processing continues; the submitter gets its answer now. | `UNAVAILABLE`, `'no'` / `'unknown'` |
| Replay throws / determinism check fails | Activation fails, actor FAULTED (`phase: 'replay'|'determinism'`), `onFault` fires. | `FAULTED` / `NONDETERMINISTIC` |
| Timer command fails with a retryable error | Timer re-armed after `timerRetryMs` unless replaced meanwhile. | — |
| Node crashes | Its membership entry and leases expire; placement moves its actors; new owners wait for the lease TTL, recover from PostgreSQL and re-arm timers. | in-flight requests time out: `UNAVAILABLE`, `processed: 'unknown'` |

`processed: 'no'` errors (`NOT_OWNER`, `FENCED`) are retried by the router
until its deadline; everything else is returned. Retry `'unknown'` outcomes
only with the same idempotency key.

## Recovery

`activate(kind, id)`:

1. acquire the lease (`leases.acquire`); if another node holds it, wait —
   polling every ttl/10 and woken immediately by `runtime:lease-released`
   notices — up to `acquireWaitMs` (default ttl + renew);
2. subscribe to the actor's command channel (only lease holders subscribe);
3. load the latest snapshot (`fromSnapshot`) or `initialState`, then replay
   `commandsAfter(snapshotSeq)` in pages of 1,000 through `step` with the
   recorded envelopes and canonicalized commands — no persistence,
   publishing, projections or timers; a gap in the command log or a logged
   command replaying as a noop is a `DeterminismError`; a replayed result
   that breaks `checkStepResult` (e.g. an event-seq gap) is a `ReplayStepError`;
4. optional determinism check (`verifyOnRecovery`): replayed events must equal
   logged events (count, seq, kind, at, payload) and no logged event may
   follow the last replayed one;
5. re-arm `pendingTimers(state)` (past deadlines fire immediately), mark
   active, drain commands queued during activation.

Graceful `deactivate` drains accepted commands, writes a final snapshot (not
fatal if it fails: the log is authoritative), cancels timers, unsubscribes and
releases the lease. `abandon()` / `NodeRuntime.kill()` simulate a crash.

## Cluster: membership, placement, routing

- **Membership.** Each node heartbeats `{nodeId, role, startedAt, capacity}`
  every `heartbeatMs` (default 2 s) with TTL (default 3 heartbeats). Redis
  stores entries in one hash with the expiry embedded and computed from
  Redis `TIME` (no clock skew; works without Redis 7.4 field TTLs); a Lua
  read prunes expired entries. Join/leave are also announced on
  `runtime:membership` so peers refresh immediately.
- **Placement.** Weighted rendezvous hashing of `kind:actorId` over live
  nodes serving the pool (`worker|all` for tables, `orchestrator|all` for
  directors; gateways never own). Adding a node moves ~1/n of the actors,
  all to the new node.
- **Rebalancing.** On every membership change (and every
  `rebalanceIntervalMs`), for the catalog's ids plus hosted ids: actors placed
  elsewhere are deactivated gracefully (the new owner acquires as soon as the
  release notice arrives); actors placed here are activated (16 in
  parallel); hosted actors absent from the catalog (closed tables, finished
  tournaments) are deactivated once idle — nothing queued or in flight, no
  armed timer, no submit for `catalogGraceMs` (default 60 s) — so they stop
  renewing leases and holding memory (a later command re-activates on
  demand). Leases — not membership — guarantee single ownership while views
  disagree. Nodes do nothing while their own entry is missing from the view.
- **Routing.** `submit` uses the local mailbox when the actor is hosted here
  (single node: no serialization or network). Otherwise, if placement says
  "here", it activates on demand. Otherwise it publishes an RPC request to the
  actor channel (`table:{id}:cmd`, `director:{id}:in`, `{kind}:{id}:cmd`);
  the lease holder acks immediately, processes the command through its
  mailbox and replies on `node:{requester}:replies`. Unacked requests are
  re-published with the same correlationId and an increasing `attempt`
  (150 ms doubling to 1 s) and also sent to the placement owner's
  `node:{id}:inbox`, which activates the actor on demand. No reply by the
  deadline → `UNAVAILABLE` (`processed: 'unknown'`). The deadline also
  bounds local submits (fast path and actors still activating).
- **Exactly once across owners.** The owner logs a routed command with
  `commandId = correlationId` (`UNIQUE (table_id, command_id)` for tables,
  mirrored by `MemoryActorLog`). Each node keeps the final reply of the last
  50,000 correlationIds and re-sends it to a retransmission (ack and result
  both lost). An owner whose first copy of a request is a retransmission
  (`attempt > 0`: e.g. it took over after a hand-off) first looks for the
  correlationId among the last 1,000 logged commands; if found, it answers
  with that command's reply, recomputed by replaying the log up to the
  command (`step` is deterministic) instead of applying it again.

## Measured

- In-memory log, 100 actors × 200 commands submitted concurrently:
  ≈ 18,000–25,000 commands/s on the dev container (`runtime-bench.test.ts`;
  the low end while other test files run in parallel).
- Two-node failover with Redis (membership TTL 600 ms, lease TTL 900 ms):
  new owner active ≈ 0.85 s after the crash (`runtime-cluster.test.ts`).

## Contract notes

- `director_inputs` has no `command_id` / `action_id` columns, so
  `PostgresDirectorLog` stores `{ commandId, actionId, command }` in the
  `input` JSONB. Director idempotency is therefore actor-level only (no DB
  unique index). `tournament_events` has no visibility/version columns:
  director events must be PUBLIC (a PRIVATE one fails the transaction) and
  their version reads back as the seq.
- `TableLogRepo.append` maps every unique violation (seq, command_id,
  action_id) to `DuplicateSequenceError`; the host tells them apart by
  checking whether its seq exists in the log (`FENCED` vs `CONFLICT`).
- Snapshot state (`table_snapshots.state`, `director_snapshots.state`) is
  stored as JSON text inside the JSONB column (a JSONB string), because a
  JSONB object would reorder keys and a state restored from a snapshot must
  iterate exactly like the live state. Rows holding a JSONB object load as-is.
- `director_inputs` has no unique index on the commandId inside `input`: a
  retransmitted routed director input older than the 1,000-command lookback
  window would not be recognized (tables are protected by the unique index).
- `commandsAfter` is the only lookup the host needs for retransmissions; a
  `findByCommandId` repo method plus an index would make it O(1).
- The `tables.owner_node / lease_epoch` columns and `TableLogRepo.acquireLease`
  are not used: ownership is the `LeaseManager`'s; the seq primary key fences.
- Actor discovery for proactive activation comes from an `ActorCatalog`
  (open tables, running tournaments); the poker adapter must supply one —
  otherwise actors activate only on demand, and after a node failure an
  actor with pending timers would wait for its next command.
