# Reports (§2.18)

The tournament report as a document: on screen in the dark theme, printed black on white.

- **Data:** `GET /tournaments/:id/report` (EXPORT_DATA) → `TournamentReportDto`, refreshed every
  30 s while the tournament runs (a report of a COMPLETED / CANCELLED tournament never polls).
  Before completion the document says "Provisional … as of <time>".
- **Contents (every DTO field):** name, id, status, generated at; champion (name, public id,
  prize); key figures — players, entries and re-entries (`entries − players`), tables used,
  duration, hands played, average hand duration, final-table duration, started, completed /
  cancelled, largest pot (chips + winner, link to the hand), prize pool; payout status
  (configured / awarded / paid / outstanding + paid %); final standings (place, player, public id,
  tie, prize); prize structure (bands of equal prizes, band totals, pool total); fairness (server
  seed commitment, seed revealed, link to Fairness). `model.ts` only re-expresses server figures.
- **Print / save as PDF:** the browser's print dialog (`window.print()`). `reports.css`
  `@media print` hides the shell (app.css) and every `.acr-reports-noprint` control, switches the
  document to black on white, repeats table headers on each page, avoids breaking rows and figure
  blocks, and always prints every row (long tables are folded to 20 rows on screen only, with
  "Show all"). Print rules are scoped with `:has(.acr-reports-doc)` so they never affect other
  screens even after this chunk is loaded.
- **Exports:** "Export JSON" re-fetches the report and saves it (`report-<slug>-<UTC stamp>.json`);
  "Export CSV" downloads `report.csv` through the API client. `download.ts` / `DownloadButton.tsx`
  are shared with Standings and Payouts (fetch through the typed client → Blob → save; friendly
  toasts, never a raw error page).

## Contract notes

1. The JSON report carries the first 100 finishing positions (`reportOf(…, standingsLimit = 100)`);
   the CSV has every player. The document says so when the field is larger.
2. `report.csv` has no prize-structure section; the JSON export does.
3. Mock data only: the "Winter Classic 2025" mock report shows a negative `handsPlayed` and a
   ~0 s duration (the mock generator's `handsCompleted` / start-completion times for that
   tournament). The UI shows server values as they are.
