# Player detail (§2.8)

Everything about one player and every per-player control.

- **Data:** `GET /players/:playerId` (polled every 10 s, refetched at once when a live event
  concerns the player — `concernsPlayer`) + the player's seat in the watched admin table frame
  (`useWatchedTable`): stack, connection and timeouts update live; "hand in progress" comes from
  the frame too.
- **Personal data** is masked. With `PLAYER_VIEW_PII` (and `piiAvailable`), "Show personal data"
  calls `GET /players/:id/pii`, which the server audits (`VIEW_PII`). The values live in
  component state only — never in the query cache — and are dropped on "Hide" or navigation.
- **Controls** (hidden when the role lacks the permission; the server re-checks):

  | Control | Endpoint | Level |
  | --- | --- | --- |
  | Move (table picker + optional seat, reason required) | `playerMove` | 1 |
  | Suspend / Restore | `playerSuspend` / `playerRestore` | 1 / 2 `RESTORE` |
  | Disqualify | `playerDisqualify` | 2 `DISQUALIFY` |
  | Adjust stack (before/after chips, BB, chip total) | `playerAdjustStack` | 2 `ADJUST` |
  | Revoke all sessions | `playerRevokeSessions` | 2 `REVOKE` |
  | New rejoin code (card: code, public id, link, join QR, print) | `playerRejoinCode` | 1 |
  | Private notice (≤ 280 chars) | `playerNotice` | 1 |

  The move dialog lists only tables with a free seat (`maxPlayers = config.tables.maxSize − 1`,
  server-side, searchable by number); the seat grid comes from the destination table detail and
  "automatic" lets the seat-fairness formula choose.

## Contract notes

1. No QR generator exists in `@jpb/ui` or the client SDK, so the rejoin card shows the
   tournament join QR (`GET /qr.svg`) plus the rejoin link as text. Suggested: return
   `rejoinQrSvg` with `RejoinCodeResponse` (generated with the code — the server keeps only a hash).
2. `PlayerDetailDto` has no reconnect count (§2.8 "reconnect count"): the sessions panel shows the
   number of sessions instead. The game server always sends `SessionDto.isController = false`; the
   panel then shows the most recently seen active session as "Most recent device".
3. The hands list link uses `?playerId=` on the Hands section (owner: hands section).
