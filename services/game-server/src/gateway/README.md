# WebSocket gateway (`src/gateway`)

The gateway owns client connections and nothing else. It holds **no game
state**: everything it sends comes from the actor runtime through the
`GatewayBackend` contract (`runtime/contracts.ts`) and the message bus
(`bus/bus.ts`). Any gateway node can therefore serve any client, and a
reconnect always starts from an authoritative snapshot.

| File | Responsibility |
| --- | --- |
| `plugin.ts` | Fastify module: registers `@fastify/websocket`, `GET /ws`, upgrade checks (draining, Origin, per-IP rate limit, cookie → principal) |
| `gateway.ts` | Connection lifecycle, hello/authorization, snapshots, table subscription, actions, takeover, bus fan-out, heartbeat, shutdown |
| `connection.ts` | One socket: identity, audience state, per-connection rate limits, ordering (sync buffer), backpressure |
| `views.ts` | **The privacy rules**: per-recipient projection and shared serialization of `table_update` frames |
| `controller.ts` | One controller per player + debounced presence reporting |
| `presence.ts` | `PresenceStore` (controller keys): memory and Redis implementations |
| `hub.ts` | Reference-counted bus subscriptions (one per channel per node) |
| `delay.ts` | Per-tournament FIFO delay line for spectator/display frames |
| `display.ts` | Admin scene switch (`DISPLAY_SCENE`) forwarded to DISPLAY sockets as `display_scene` |
| `protocol.ts` | zod validation of client frames |
| `origin.ts` | Cross-site WebSocket hijacking check |
| `options.ts` | Tunables and close codes |

## Wiring

```ts
const gateway = new Gateway({ nodeId: env.nodeId, backend, bus, sessions: ctx.sessions, metrics, presence });
const app = await buildHttpApp(ctx, { modules: [gatewayModule(gateway)] });
```

`presence` is `new MemoryPresenceStore()` on a single node and
`new RedisPresenceStore(redisBus.client)` when nodes share Redis. `app.close()`
runs the graceful shutdown (below). The admin reveal endpoint calls
`gateway.revealHoleCards({ tableId, adminId, sessionId })` on its node **or**
publishes `{ kind: 'HOLE_CARDS_REVEALED', … }` on `admin:{tournamentId}` so the
node holding the admin's socket applies it.

## Protocol walkthrough

1. **Upgrade** `GET /ws`. Before the socket is accepted:
   - draining node → `503`;
   - `Origin` must equal the origin of `PUBLIC_BASE_URL` (or an explicitly
     configured extra origin) → otherwise `403`. Browsers attach cookies to
     cross-site WebSocket upgrades and CORS does not apply, so this is the
     defence against cross-site WebSocket hijacking. A *missing* Origin means
     a non-browser client (browsers always send it); it is allowed only when
     `NODE_ENV !== 'production'`;
   - per-IP upgrade rate limit (generous: venues put many players behind one NAT) → `429`;
   - cookies `jpb_ps` (player) and `jpb_as` (admin) are resolved with
     `SessionService.resolve`. A missing, forged, expired or revoked cookie
     yields *no identity* rather than a rejected upgrade, so a stale cookie
     can never lock someone out of public audiences; PLAYER/ADMIN hellos
     without the right identity are refused with `4401`.
2. **hello** must be the first frame, within 10 s (`4408` otherwise; any
   other first frame `4400`). `v` must be `PROTOCOL_VERSION` (`4400`).
   Frames pipelined right behind hello are processed after it.
3. Authorization by audience (`4401` no identity, `4403` not allowed, `4404` unknown tournament):

   | Audience | Requirement |
   | --- | --- |
   | PLAYER | player session whose `tournamentId` equals `hello.tournamentId` |
   | ADMIN | admin session with `PLAYER_VIEW` and tournament scope (`adminCan`) |
   | SPECTATOR | `backend.canSpectate(tournamentId, playerId \| null)` (playerId only from a player session of that tournament) |
   | DISPLAY | `backend.canDisplay(tournamentId)` |

4. Server answers `welcome` (its `sessionId` is the **connection id**, never
   the auth session) and then an authoritative `snapshot` (`ClientSnapshot`
   built from `tournamentSummary` / `playerSelf` / `tableSnapshot`). A PLAYER
   that is not the controller then gets `another_device`.
5. Afterwards: `table_update`, `tournament_event`, `self_update`, `notice`,
   `action_result`, `pong`, `error`, `session_replaced`. **Every server frame
   carries `st`** (server epoch ms).

Client frames after hello:

| Frame | Who | Behaviour |
| --- | --- | --- |
| `ping {ct}` | all | `pong {ct, st}` (clock-offset estimation for cosmetic timers) |
| `action` | PLAYER controller | rate limited (burst 4, 2/s per connection); forwarded to `backend.submitPlayerAction` with the session's playerId and `receivedAt` = receipt time; answered with `action_result` mirroring the `CommandReply` |
| `takeover` | PLAYER observer | becomes controller (see below), then gets a fresh snapshot |
| `watch {tableId \| null}` | SPECTATOR, ADMIN | any table **of the same tournament** (verified via `tableSnapshot().tournamentId`); answered with a snapshot |
| `snapshot_request` | all | fresh snapshot (burst 3, 1 per 2 s) |

Every frame is size-checked (4 KB → `FRAME_TOO_LARGE` error frame; above
16 KB `ws` closes with `1009`), JSON-parsed and validated by a strict zod
schema (unknown keys rejected). Malformed/unknown/binary frames produce an
`error` frame and are ignored; nothing a client sends can throw inside the
gateway. All frames share a per-connection budget (burst 30, 10/s); excess
frames are dropped with a throttled `RATE_LIMITED` error, and after 50
violations the socket is closed with `1008`.

### Resume

`hello.resume` is accepted (and counted in `jpb_reconnects_total`) but the
gateway **always** answers with a full authoritative snapshot. Gateways are
stateless and keep no per-client replay buffer, so they cannot know what a
client missed; replaying from the PostgreSQL event log would need
per-recipient privacy filtering of every historic event and could replay
state the snapshot already supersedes. A snapshot is bounded in size,
privacy-filtered by construction and is what the spec requires anyway
(server state always wins, §76/§114). Every `table_update` carries the
complete view, so nothing is lost. For SPECTATOR/ADMIN, `resume.tableId` is
used to re-watch that table (if it still belongs to the tournament).

### Close codes

| Code | Meaning | Client should |
| --- | --- | --- |
| 1012 | service restart (deploy / scale-in) | reconnect (any node) |
| 1013 | slow consumer (send buffer > 8 MB) | reconnect |
| 1008 | sustained rate-limit abuse | back off |
| 1009 | frame above the hard ws limit | fix the client |
| 4002 | silent for > 30 s | reconnect |
| 4400 | bad/missing hello or protocol version | fix the client |
| 4401 | no/expired/revoked session | sign in / rejoin |
| 4403 | not allowed for this audience/tournament | — |
| 4404 | unknown tournament | — |
| 4408 | no hello within 10 s | reconnect |
| 4409 | session replaced by another device | **do not** auto-reconnect |

## Privacy guarantees

All table data leaves through `views.ts`:

- **PLAYER** gets PUBLIC events plus PRIVATE events whose `privateTo` is the
  player, and `view = {...publicView, audience: 'PLAYER', you}` with `you`
  taken from `privateByPlayer[playerId]` only. A player not (or no longer)
  seated at the table gets the public projection.
- **SPECTATOR / DISPLAY** get PUBLIC events and `publicView` only (never
  `privateByPlayer`, `holeCardsBySeat` or private events), delayed by
  `backend.spectatorDelayMs`.
- **ADMIN** gets `adminView` with `holeCards: null` and PUBLIC events, unless
  that socket had an audited reveal for the table **and** still holds
  `VIEW_HOLE_CARDS` — then `holeCards = holeCardsBySeat` and private events.
  A reveal is bound to the socket and the table it was watching; it ends when
  the socket watches another table, disconnects, or loses the permission
  (sessions are re-validated every 60 s).
- Defence in depth: a `HOLE_CARDS_DEALT` event reaches only its own player
  even if mislabelled PUBLIC; a PRIVATE event without `privateTo` reaches no
  player; table updates are only sent to sockets of the same tournament.
- `INTEGRITY_ALERT` tournament events go to admins only (they contain
  internal details).
- Property tests (`test/gateway-fanout.test.ts`) assert all of the above
  over random deals and event streams, both on the serializer directly and
  through real sockets for every audience at once.

Spectator delay: table updates and tournament events for spectators/displays
go through one FIFO delay line per tournament, so their relative order is
preserved (a lowered delay never reorders). Snapshots for these audiences use
the last *released* state; if nothing has been released yet the snapshot has
`table: null` and the live state is pushed through the delay line. Zero delay
is immediate.

## One controller per player (spec §70)

- The controller key (`PresenceStore`, `jpb:presence:ctl:{playerId}` on
  Redis) holds `{connectionId, nodeId}` with a TTL (20 s) refreshed every 5 s
  while the socket lives; all writes are compare-and-set.
- The first PLAYER socket claims it; later ones get `another_device` and stay
  **observers**: they receive every frame the controller gets (their own
  player's private data only) but actions are answered with
  `action_result {ok:false, code:'INVALID_COMMAND'}`.
- `takeover` force-claims the key, replaces local controllers immediately and
  publishes `CONTROLLER_CLAIMED` on `player:{id}`; the node holding the old
  controller sends `session_replaced` and closes it (`4409`). Because two
  takeovers on different nodes can deliver their messages in either order,
  the presence store — not message order — decides which socket is replaced.
  A refresh that finds the key owned by someone else also replaces the socket
  (covers a lost bus message).
- Closing the controller releases the key. `backend.playerConnection(true)`
  is reported when a node gains the controller; `false` only after the
  controller has been gone for 3 s **and** no controller exists on any node,
  so refreshes and node hops never flap the table's away state.
- Duplicate `actionId`s are passed through: the table actor answers them
  idempotently with the original reply. The gateway never dedupes (it cannot
  know whether the first attempt reached the actor).
- If the backend call throws, the client gets
  `action_result {ok:false, code:null}` ("could not confirm, retrying is
  safe" — idempotency makes the retry safe).

## Backpressure, heartbeat, shutdown

- Above 1 MB `bufferedAmount` a socket is marked **stale**: `table_update`
  frames are skipped (each carries the full view, so skipping loses nothing
  but animation events). Small frames (pong, action_result, notices) still
  flow. When the buffer drains below 64 KB the socket gets exactly one fresh
  snapshot. Above 8 MB it is closed (`1013`).
- Ordering: while a snapshot is being built, bus frames for the socket are
  held and flushed afterwards only if newer than the snapshot (table
  `version`, tournament `seq`); table updates older than the last one sent
  are dropped, so a client never sees state go backwards.
- Heartbeat: the server pings every 10 s; a socket with no frame and no pong
  for 30 s is closed (`4002`). Sessions are re-validated every 60 s
  (revocation, expiry, disabled admins, lost scope/permissions).
- `SESSIONS_REVOKED` on `player:{id}` closes every socket of that player
  (`error SESSION_REVOKED` + `4401`).
- Graceful shutdown (`gateway.shutdown()`, run by `app.close()`): new upgrades
  get 503, every socket is closed with `1012` so clients reconnect through
  the load balancer to another node, and pending presence decisions settle
  (≤ 3 s) before the process exits.

## Scaling notes

- **Fan-out cost**: one bus subscription per channel per node (`hub.ts`),
  however many local sockets watch it. For each table update the header,
  each event's JSON, the public view and the two admin variants are
  serialized once and the strings reused; per player only the event
  selection and the small `you` object are serialized. Spectator frames are
  built once per release for all spectators of the table.
- **Stateless nodes**: no sticky sessions are required. Connection state is
  rebuilt from a snapshot on reconnect; cross-node coordination is only the
  controller key (Redis) and the player channel.
- **Redis load**: one `EVAL` per controller socket per refresh interval
  (e.g. 50,000 players on a node → 10,000 ops/s at 5 s); raise
  `controllerRefreshMs`/`controllerTtlMs` together for very large nodes.
- **Spectator surges** (final table on a big screen + thousands of phones)
  cost one delay-line entry per update per tournament plus one shared string
  per release.
- Metrics (`observability/catalog.ts`): `jpb_ws_connections{audience}`
  (including `PENDING` before hello), `jpb_ws_connects_total`,
  `jpb_ws_disconnects_total`, `jpb_ws_messages_in_total{audience}`,
  `jpb_ws_messages_out_total{audience}`, `jpb_reconnects_total{audience}`,
  `jpb_errors_total{area="gateway"}`, plus the disconnect/reconnect rate
  windows used by the control room.

## Contract notes

Additive changes to `runtime/contracts.ts` (the runtime must implement/publish them):

- `GatewayBackend.canDisplay(tournamentId)` — whether broadcast displays may
  follow the tournament (`features.broadcastDisplay`).
- `DisplayFeaturedMessage` (`DISPLAY_FEATURED_CHANGED`) on
  `tournament:{id}:events` (`TournamentChannelMessage`) — the admin display
  endpoint publishes it; displays are re-pointed. `tableId: null` means
  "automatic": the gateway asks `featuredTable()` (final table or first open
  table) instead of pointing displays at no table. The featured table is also
  re-queried after `FINAL_TABLE_FORMED`, `TABLE_BROKEN` and `TABLE_CREATED`.
- `AdminChannelMessage` `HOLE_CARDS_REVEALED {tableId, adminId, sessionId}` —
  published by the audited reveal endpoint.
- `DISPLAY_SCENE {tournamentId, scene, tableId}` on `tournament:{id}:events`
  (published by the admin display endpoint) is forwarded to the tournament's
  DISPLAY sockets only, immediately (no spectator delay: no game data), as the
  additive frame `{ t: 'display_scene', st, scene, tableId }` (`display.ts`).
  It is not yet part of the shared `ServerMessage` union; clients that do not
  know it ignore it. Malformed messages (scene > 40 chars) are dropped.

Interpretations:

- A PLAYER `table_update` for a table where the player has no
  `privateByPlayer` entry carries the public view (`audience: 'SPECTATOR'`);
  in a PLAYER snapshot such a table is `null`.
- Actions are forwarded for any `tableId`; the table actor rejects actions
  from players not seated there (server authority stays in the actor).
- DISPLAY sockets cannot `watch`; they always follow the featured table.
