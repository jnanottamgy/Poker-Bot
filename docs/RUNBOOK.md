# Event-day runbook

A practical guide for the people running the tournament. The software runs
the poker; staff handle people and exceptions.

## Before doors open

1. Server up: `docker compose ps` all healthy; `/readyz` returns ok.
2. Log in to the admin control room on two devices (main + backup).
3. Create the tournament (or clone last event), review blinds, breaks, prizes.
4. Open registration; show the QR code on the projector (Registration → QR
   → full screen). Optionally print the poster.
5. Test with your own phone: join, refresh, lock the phone for a minute,
   unlock — you should land back in your seat.

## Running

| Situation | What to do |
| --- | --- |
| Start | Registration → **Start tournament** (seating preview shows tables). Players see TABLE / SEAT / STACK and a countdown. |
| Player's phone died / switched phones | Players → find player → **New rejoin code** → show the rejoin QR to the player. Their seat, stack and current hand are untouched; meanwhile the server auto-checks/folds for them. |
| Player says "it didn't let me act" | Open the table → the hand log shows exactly what the server received and when (deadline, grace). Timeouts are applied automatically; the log is the source of truth. |
| A table shows STALLED | Table detail → see acting seat and last progress. Usually a player is disconnected and the timer will act; if not, **Force timeout**. If it persists, **Hold**, then **Release**. An alert is raised automatically. |
| Need everyone to stop (announcement, venue issue) | **Pause after hand**: hands in progress finish, then all tables wait. **Resume** when ready. |
| Something looks wrong right now | **Emergency freeze** (top bar, double confirmation): stops all actions immediately and preserves remaining action time. Investigate, then **Unfreeze**. |
| Break time | Breaks start automatically per the schedule; **Start break now / End break now** under Clock. |
| Clock needs adjusting | Clock → add/remove time; advance level; set level (double confirmation). |
| Player misconduct | Players → **Suspend** (auto check/fold, keeps chips) or **Disqualify** (removes chips from play; double confirmation). Always enter a reason. |
| Dispute about a hand | Hands → open the hand → **Replay** street by street; **Verify** shows the deck matches the committed seed once revealed. |
| CRITICAL chip-conservation alert | Johnny already holds the affected tables. Do not release. Check Alerts → affected table → internals; contact the technical lead. Every chip move is in the hand history. |
| Server/laptop restarted | Wait for `/readyz`; tournament resumes from the database automatically. Players reconnect on their own. Check Overview → chip conservation is green. |
| Internet dropped (tunnel mode) | Players reconnect when it returns; their timers keep running server-side. If the outage is long, **Pause after hand** and announce. |
| Multi-node: one server died | Nothing to do. Within a few seconds the surviving nodes take over its tables and Johnny from the database (System shows the node gone); players reconnect automatically. Check Overview → chip conservation stays green. |
| Multi-node: Redis restarted or unreachable | Tables stop accepting actions while their ownership cannot be confirmed (never two owners), then resume by themselves when Redis is back. Timers resume from their stored deadlines. If it lasts more than a minute, **Pause after hand** and announce. |
| Database slow or restarting | Actions are acknowledged only once stored; players may see "confirming…" longer. Nothing is applied twice and nothing is lost. If `/readyz` stays red, check the PostgreSQL container and disk space. |
| A table shows TABLE CRASHED (critical alert) | Johnny halted that table rather than risk a wrong state. Do not touch it; note the alert details and contact the technical lead (System → actor internals). Other tables keep playing. |

## After the final hand

1. The champion screen appears on the big display and the winner's phone.
2. Standings → verify finishing positions and prizes.
3. Payouts → mark each prize PROCESSING / PAID with a reference; export CSV.
4. Fairness → **Reveal seed** (double confirmation) so anyone can verify.
5. Reports → export the tournament report (JSON/CSV, printable).
6. Audit log → **Verify chain**; export.
7. Back up `./backups` and `.env` somewhere safe.
