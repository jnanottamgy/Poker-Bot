# @jpb/broadcast-display

The big screen: projector, TV or OBS browser source. Public data only, server
authoritative, no AI. Served by the game server under `/display/`.

## URLs

| URL | Meaning |
| --- | --- |
| `/display/?t=<tournamentId>` | Live, by tournament id (the admin dashboard's link). Prize data and the join code (leaderboard) come from the admin overview when an admin is signed in on this screen. |
| `/display/?code=<joinCode>` or `/display/<joinCode>` | Live, by join code (public join info; for simulations the public summary supplies the id). |
| `&scene=LEADERBOARD` | Pin one scene (a dedicated screen). |
| `?demo=1[&preset=running\|final\|bubble\|break\|paused\|frozen\|champion\|pre][&seed=x][&net=reconnecting]` | Deterministic demo, no server. |

Keys: **F** fullscreen, **S** next scene (held 45 s, then rotation resumes).

Dev: `JPB_API_TARGET=http://localhost:8108 JPB_DISPLAY_PORT=5208 npx vite` (defaults `http://localhost:8080`, port 5175).

## Data flow

- One WebSocket via the client SDK's `GameConnection` (backoff with full
  jitter, heartbeat, dead-socket detection) and `ClockSync`. `hello { v: 1,
  audience: 'DISPLAY', tournamentId, resume: null }`; the server answers with a
  snapshot `{ audience: 'DISPLAY', tournament, featured }`, then `table_update`
  (public view) for the featured table, `tournament_event` (full feed) and a
  new snapshot whenever the featured table changes.
- Raw frames go to a pure reducer (`src/model/reducer.ts`): the latest server
  view always replaces the previous one (older table versions are ignored,
  tournament events are deduped by seq). It derives the ticker, splashes,
  eliminations, showdown/winner state, the acting-seat timer, pause/freeze,
  the champion and the admin scene. Time arrives in actions.
- REST: `GET /api/public/tournaments/:code/leaderboard?mode=stack&limit=10`
  every 15 s and after each elimination (`mode=finish` once complete); join
  info (prizes) every 2 min.
- Refusals (`DISPLAY_NOT_ALLOWED`, …) are shown full screen and retried every 30 s.

**Never stale as live:** the LIVE marker shows only while the socket is open
*and* a snapshot arrived on this connection. Otherwise the stage is greyed
(`data-stale`) and a discreet "Reconnecting" chip replaces LIVE.

## Scenes

Precedence (`src/model/scenes.ts`): S-key pick → a new announcement (15 s) →
the admin's choice (held until the admin picks another; cleared when the
tournament completes) → CHAMPION (complete) → BREAK (status BREAK) → idle
rotation OVERVIEW (16 s) → FEATURED_TABLE or FINAL_TABLE (32 s) → LEADERBOARD
(14 s, once there is ranking data or an elimination). A scene that is not
available (no featured table, no champion) falls back to the rotation.

- OVERVIEW: blind clock (level, countdown, progress, blinds/ante, next level),
  players remaining/registered, tables, average stack (= chips in play ÷
  players remaining, also in BB), chip leader (rank 1 of the stack ranking),
  prize pool (Σ configured places). Before the start: join code and registrations.
- FEATURED / FINAL TABLE: oval with seats clockwise from the bottom centre,
  stacks (+BB), bets, board, pot, dealer button, acting-seat timer ring
  (deadline from the view, total from `ACTION_REQUESTED.timerMs`), showdown
  reveals, winners (gold) with the winning five highlighted. Final table adds
  the pay ladder.
- LEADERBOARD: top 10 by stack (server label, "live ranking, not a result")
  plus recent eliminations.
- ANNOUNCEMENT, CHAMPION, BREAK (countdown to `breakEndsAt`), PAUSED / FROZEN
  overlays (clock stopped value), milestone splashes (one at a time, 5.5 s,
  queue of 6, dropped when older than 30 s): eliminations at finishing
  position ≤ 27 or inside the money, final table, table breaks, bubble /
  hand-for-hand, milestones, blinds up. Bottom ticker of the last 14 events.

Layout is a 16:9 frame letterboxed into any window; every size is a multiple
of `--u` (1 % of the frame width), so 1920×1080 is the reference. Colours are
`@jpb/ui` tokens; `prefers-reduced-motion` / `data-motion="reduced"` stop all
animation (the ticker becomes static).

## Demo mode

`src/demo/` synthesizes the same frames the server sends from a seeded
mulberry32 PRNG (`?seed=`), never `Math.random`. Showdowns are scripted hands
whose winners and descriptions are correct by construction; chips are
conserved (tested). The demo chunk is only loaded with `?demo=1`.

## Contract notes

- Admin scene switching needs the gateway to forward `DISPLAY_SCENE` (added:
  `services/game-server/src/gateway/display.ts`) as the additive frame
  `{ t: 'display_scene', st, scene, tableId }`, which is not yet in the shared
  `ServerMessage` union (the app types it locally, `DisplaySceneFrame`).
- The admin route rejects any scene other than OVERVIEW, LEADERBOARD,
  FINAL_TABLE, ANNOUNCEMENT, CHAMPION, FEATURED_TABLE, so there is no "back to
  auto-rotation" from the dashboard; the display understands `AUTO` (and any
  unknown scene) as auto-rotation if the route ever allows it. Reloading the
  page also returns to auto-rotation (the scene choice is not replayed to
  newly connected displays).
- `DISPLAY_FEATURED_CHANGED` with `tableId: null` means "automatic"; the
  gateway now asks `featuredTable()` instead of pointing displays at no table.
- Join info is not public for simulations; `?code=` then resolves through
  `/summary`, and prize data needs an admin session.
