# Security model

**Assume the browser is hostile.** A player may edit JavaScript in DevTools,
replay requests, script WebSocket frames, or share their screen. None of that
may let them see another player's cards, change chips, act out of turn, skip
timers, change table assignments or impersonate someone.

## Threats and mitigations

| Threat (spec §109–111) | Mitigation |
| --- | --- |
| See opponents' hole cards | Hole cards exist only in the table actor's state. Per-audience serializers (`PlayerTableView`, `SpectatorTableView`, `AdminTableView`) are the only way state leaves the server; private events (`HOLE_CARDS_DEALT`) are routed only to the owner's sockets. Property tests assert no view for player X ever contains another player's unrevealed cards. Hole cards never touch HTML, localStorage or public frames. |
| Manipulate chip values / pot | Clients send intentions only (`{type, amount}`); the reducer recomputes everything. Chip conservation is checked continuously; a violation holds the table and raises a CRITICAL alert. |
| Act out of turn, force actions, illegal raises | Table actor validates seat, turn, legal action, amount bounds (safe integers, min/max raise) and `tableStateVersion`. Illegal input returns a code; nothing is clamped silently. |
| Skip or extend timers | Deadlines are server-side absolute times; the client countdown is cosmetic. Late actions (after deadline + grace) are rejected; timeouts are applied by the server. |
| Replay old actions / double submit | Every action carries a unique `actionId`; the actor remembers processed ids and the database enforces `UNIQUE(table_id, action_id)`. Stale `tableStateVersion` is rejected. |
| Spoof another player | 256-bit random session tokens stored as SHA-256 hashes, HttpOnly + SameSite cookies, Secure in production. Player identity is bound server-side to the session; client-supplied ids are ignored. |
| Two devices for one player | One controller connection per player; others get `another_device` and must explicitly take over (the old socket is closed with `session_replaced`). |
| Change table assignments / call hidden APIs | Moves are director decisions; the only admin move endpoint requires `PLAYER_MOVE`. Every admin route checks session, CSRF, permission and tournament scope server-side. |
| CSRF | SameSite=Lax cookies plus double-submit `x-csrf-token` on every state-changing request. |
| Brute force (admin login, rejoin codes) | Token-bucket rate limits per IP and per identity, account lockout after 5 failures (15 min), scrypt password hashing, timing equalization for unknown users. |
| Flooding / spam (RAISE RAISE RAISE) | Per-connection and per-player action limits (burst 4, 2/s), WS frame size limits, schema validation of every frame, HTTP body limit 64 KB. |
| XSS | React escaping, strict Content-Security-Policy (`script-src 'self'`), registration input sanitization (control and zero-width characters stripped, HTML-like input rejected, length limits). |
| Admin abuse | RBAC with least privilege, tournament scoping, double confirmation + mandatory reason for dangerous operations, append-only hash-chained audit log (database trigger forbids UPDATE/DELETE), audited reveal of live hole cards and PII. |
| Organizer altering the deck | Commit–reveal: SHA-256 of the server seed published before registration; decks derive deterministically from seed + public entropy (players' client seeds) + table + hand number; anyone can verify after the reveal. See FAIRNESS.md for limits. |
| Database leak | Session tokens hashed; passwords scrypt-hashed; server seeds AES-256-GCM encrypted with a key held outside the database; PII limited to configured fields. |
| Split-brain (two nodes running one table) | Leases with fencing epochs plus gap-free `(table_id, seq)` primary keys: a stale owner cannot append. |

## Data exposure rules

- Other players see: display name, public id, stack, seat, actions, cards
  shown at showdown. Never email, phone, participant/college id, IP, device.
- Spectators: public table data only, optionally delayed.
- Admins: by permission. `PLAYER_VIEW_PII` for contact fields,
  `VIEW_HOLE_CARDS` for live hole cards (audited), `HAND_HISTORY_VIEW` for
  completed hands, `PAYOUT_*` for payment records.

## Operational security checklist

- Run `node scripts/setup-env.mjs` (strong random secrets) and keep `.env`
  private; change the bootstrap admin password after first login.
- Use HTTPS whenever the event is reachable from the internet (free
  Cloudflare tunnel); LAN-only HTTP mode is for offline venues.
- Give staff the least-privileged role (STAFF/VIEWER); keep SUPER_ADMIN for
  one or two people.
- Never enable `SPEED_MODE_ALLOWED` or `SIMULATION_ALLOWED` on a production
  event server.
- Review the audit log after the event; verify the chain.
