# @jpb/player-web

Mobile-first player app: QR join → registration → one-time rejoin code →
lobby → live table → notices → elimination / champion → spectator. Served by
the game server from `STATIC_DIR/player` (see
`services/game-server/src/http/static.ts`). It only sends intentions; every
screen is derived from server frames (`src/play/deriveScreen.ts`).

## Run

```bash
# against a running game server (default http://localhost:8080)
JPB_API_TARGET=http://localhost:8109 JPB_PLAYER_PORT=5209 npx vite        # in apps/player-web
# in-browser mock backend (no server)
npx vite --mode mock
```

The server's WebSocket gateway only accepts browser upgrades whose `Origin`
equals `PUBLIC_BASE_URL`, so start the server with
`PUBLIC_BASE_URL=http://localhost:<vite port>` when using the dev proxy.

Tests: `npx vitest run --project ui apps/player-web/test`; the browser
end-to-end test (real server, fresh production build, headless Chromium) is
`tests/e2e/player-browser.test.ts` (needs `TEST_DATABASE_URL`).

## Rules the app follows

- **Notices.** Full-screen notices (seat / table move, elimination, champion,
  suspension) and the final-table moment never cover a pending decision: they
  stay queued while it is the player's turn. A seat card is dropped once a
  later move / elimination / title supersedes it, and hidden while the player
  is out. Staff messages (`MESSAGE`, from `ADMIN` or `DIRECTOR`) render as a
  banner above the table and stay until "Got it". `RESTORED` is a toast.
- **Session.** A gateway refusal `UNAUTHORIZED`, `FORBIDDEN` or
  `SESSION_REVOKED` stops reconnecting and shows the rejoin form; `another_device`
  asks before `takeover`; `session_replaced` shows a stale screen with
  "Use this device".
- **Counters** come only from the tournament summary (`tournament_event.summary`
  or the coalesced `tournament_summary` frame in fields above 300 players),
  never from counting events.
- **Re-entry.** An eliminated player gets a "Re-enter" button (with a
  confirmation) that calls `POST /api/player/reenter`; the server re-checks
  every rule and its error is shown in plain words.

## Contract notes

- Re-entry availability is not in any player-facing DTO yet
  (`PlayerSelfSummary`, `JoinInfoDto`). `src/play/reentry.ts` reads, when
  present, `self.reentry.available` / `self.reentry.open` /
  `self.canReenter`, else a `ReentryConfig` at `joinInfo.reentry` or
  `joinInfo.registration.reentry` checked against the live level and status.
  Until the server sends one of these, the button is not offered.
- With re-entry (or late registration) open, finishing positions are deferred
  and no `ELIMINATED` notice is sent at the bust; the eliminated screen then
  shows the current place estimate (`active + 1`).
- The server keeps `stack = 0` for a registered entry until it is seated; the
  lobby shows `JoinInfoDto.startingStack` instead.
