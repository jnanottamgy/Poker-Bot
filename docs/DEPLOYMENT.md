# Deployment (zero cost)

Everything Johnny's Poker Bot needs is free and open source: Node.js,
PostgreSQL, (optionally) Redis, Docker. No paid service, API key or AI provider
is required. Pick the option that fits the event.

| Option | Cost | Internet needed | Good for |
| --- | --- | --- | --- |
| A. Venue laptop on the local Wi-Fi | ₹0 | No | College events, offices, anything in one room |
| B. Venue laptop + Cloudflare quick tunnel | ₹0 | Yes | Players on mobile data, remote viewers |
| C. Oracle Cloud "Always Free" VM | ₹0 | Yes | Recurring/online tournaments, bigger fields |

> Capacity is never assumed — before an event, run the load test for your
> expected field size on the machine you will use (see "Pre-event checklist").

## Prerequisites (all options)

1. Install Docker: Docker Engine on Linux, or Docker Desktop on Windows/macOS
   (free for small businesses), or the free alternatives Rancher Desktop /
   Podman Desktop.
2. Get the code: `git clone https://github.com/jnanottamgy/Poker-Bot.git && cd Poker-Bot`
3. Install Node.js 22 (only needed to run the setup script and tests).

## Option A — venue laptop on the local network (offline)

```bash
# 1. Find the laptop's LAN address (e.g. 192.168.1.20), then:
node scripts/setup-env.mjs --lan http://192.168.1.20:8080
# 2. Start
docker compose up -d --build
# 3. Open the admin control room
#    http://192.168.1.20:8080/admin   (login printed by step 1)
```

Players join the venue Wi-Fi and scan the tournament QR code (generated in
the admin control room → Registration). The broadcast screen for the
projector is at `http://192.168.1.20:8080/display/<JOINCODE>`.

LAN mode uses plain HTTP (`ALLOW_INSECURE_LAN_HTTP=true`), acceptable only on a
private network you control. Give the laptop a static/reserved IP in the
router so the QR code keeps working, plug it into power and wired Ethernet if
possible, and disable sleep.

## Option B — free public HTTPS URL with Cloudflare quick tunnel

```bash
node scripts/setup-env.mjs --public-url https://placeholder.trycloudflare.com
docker compose --profile tunnel up -d --build
docker compose logs tunnel | grep trycloudflare.com      # shows your https URL
```

Put the printed URL into `.env` as `PUBLIC_BASE_URL` and restart the app
(`docker compose up -d app`) so QR codes use it. Quick tunnels need no
Cloudflare account; the URL changes every time the tunnel restarts, so start
it before printing QR codes. (A permanent hostname needs a free Cloudflare
account plus a domain you own.)

## Option C — Oracle Cloud Always Free VM

1. Create an Oracle Cloud account (Always Free tier; card used only for
   identity verification) and an Ampere A1 VM (up to 4 OCPU / 24 GB RAM free),
   Ubuntu 24.04.
2. Open ports 80/443 in the VCN security list and in `ufw`/`iptables`.
3. Install Docker, clone the repo, then run the app behind HTTPS — either the
   Cloudflare tunnel profile (Option B) or a free Let's Encrypt certificate via
   Caddy if you own a domain.
4. `node scripts/setup-env.mjs --public-url https://your.domain && docker compose up -d --build`

## Operating the system

| Task | Command |
| --- | --- |
| Status | `docker compose ps` · `curl localhost:8080/readyz` |
| Logs | `docker compose logs -f app` |
| Restart app (players reconnect automatically, tournament resumes) | `docker compose restart app` |
| Stop everything | `docker compose down` (data is kept in the `pgdata` volume) |
| Backups | automatic hourly `pg_dump` into `./backups` (kept 14 days) |
| Restore a backup | `docker compose exec -T postgres pg_restore -U jpb -d jpb --clean < backups/jpb-<timestamp>.dump` |
| Monitoring | `docker compose --profile monitoring up -d` → Grafana on `http://127.0.0.1:3000` |

### Crash recovery

The tournament state lives in PostgreSQL as an append-only command log plus
snapshots. If the app process or the machine restarts, the server reloads the
latest snapshot of every running table and tournament, replays the commands
after it through the same deterministic engines, re-arms every timer from the
stored deadlines, and continues. Players see "RECONNECTING… Your chips are
safe" and are put back into their seat with their exact stack and the hand in
progress.

### Secrets

`.env` holds the database password, the seed-encryption key and the initial
admin password. Keep it private and back it up together with `./backups`.
Losing `SEED_ENCRYPTION_KEY` makes it impossible to reveal the server seed of
an unfinished tournament for fairness verification.

## Pre-event checklist

1. `npm ci && npm run check` — every test passes on this machine.
2. Run a simulated tournament of your expected size from the admin control
   room (Demo → Simulation), or `npm run load -w @jpb/tests -- --players <N>`.
   Confirm action latency p95 stays well under 200 ms.
3. Create the real tournament, review blinds/prizes, open registration, print
   or project the QR code.
4. Test-join with two phones; try a refresh and airplane-mode reconnect.
5. Note the admin URL and keep a second admin account logged in on another
   device.
6. Confirm backups appear in `./backups` and the laptop will not sleep.

## Legal and event configuration boundaries

The engine uses **virtual tournament chips only**. Entry fees, prizes and
whether poker tournaments with prizes are allowed depend on your jurisdiction
and your institution's rules — the platform does not assume they are
permitted anywhere. Prizes are an administrative record (fixed structure,
payment status UNPAID / PROCESSING / PAID); the game engine never handles
money. See [LEGAL.md](./LEGAL.md).
