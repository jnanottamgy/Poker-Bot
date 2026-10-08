# Johnny's Poker Bot

A deterministic, auditable, horizontally scalable **No-Limit Texas Hold'em
tournament operating system**. Players scan one QR code, enter their name, and
their phone becomes their poker table. Johnny — the algorithmic tournament
director — handles cards, chips, blinds, pots, timers, eliminations, table
balancing and the final table without a human dealer.

> **Player count is data, not architecture.** The same code runs a 2-player
> game and is designed to distribute a 1,000,000-player field across 125,000
> tables. Capacity claims are only made where load tests prove them.

> **No AI in game logic.** See [docs/NO_AI.md](docs/NO_AI.md).

Status: under active construction — see `docs/` for the normative contracts.

## Repository layout

```
apps/        player-web · admin-dashboard · broadcast-display
services/    game-server (API, WebSocket gateway, table actors, orchestrator)
packages/    shared-types · randomness · fairness-engine · poker-engine ·
             table-engine · seating-engine · balancing-engine ·
             tournament-engine · validation · client-sdk · ui
infra/       docker · deployment · monitoring
tests/       property · integration · e2e · chaos · load
docs/        contracts, architecture, rules, fairness, operations
```

## Development

```bash
npm install
npm run check      # typecheck + lint + tests
```

Everything in this repository is free and open source to run: Node.js,
PostgreSQL and Redis. No paid services are required.
