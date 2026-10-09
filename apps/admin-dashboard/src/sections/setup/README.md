# Tournament setup wizard (§2.2)

Routes: `/tournaments/new` (create) and `/t/:tournamentId/setup` (edit while
`DRAFT` / `REGISTRATION`; afterwards a read-only summary that points to Clock &
Structure and Settings).

## Structure

- `index.tsx` — picks create / edit from the **route param** (see Contract notes).
- `CreateSetup.tsx` / `EditSetup.tsx` — save flows, banners, locked view.
- `Wizard.tsx` — stepper, current step, undo bar, sticky save bar.
- `useWizardState.ts` — draft (config + UI meta + step), server issues, one-level
  undo for bulk changes, sessionStorage persistence, issue → field focusing.
- `StartFrom.tsx` — copy another tournament's configuration into the form, or
  clone it on the server (`tournamentClone`).
- `steps/*` — the ten steps; `components/*` — fields bound to config paths,
  virtualized editors (blind levels, paid places), summary cards.
- `model/*` — pure helpers (blinds, prizes, tables, issues, diff, storage, …).

## Rules

- **Validation** is `validateTournamentConfig` from `@jpb/validation` (the
  function the server runs) on every edit. Each issue keeps its path; the DOM id
  of the control editing a path is `fieldDomId(path)`, so an issue link opens the
  step, scrolls a virtualized list to the row and focuses the field (falling
  back to the nearest ancestor path). Unparseable input commits `NaN` so a
  half-typed value is reported on that field and can never be saved.
- Saving is disabled while any issue exists. Server issues from a refused save
  (`INVALID_CONFIG` details, `JOIN_CODE_TAKEN`) are attached to their fields
  until the next edit.
- **Saves**: create = `tournamentCreate` (L0, no dialog); create + open =
  L1 dialog, then `registrationOpen`; edit = `tournamentPutConfig` (L1, optional
  reason, the confirmation lists the changes); DRAFT edit + open = L1.
- **Persistence**: the draft is written to sessionStorage (`jpb.admin.setup.v1:<id|new>`)
  300 ms after the last edit. Edit mode stores only while it differs from the
  server and remembers the base it started from; if the server config changes
  meanwhile it is adopted silently without local edits, otherwise the operator
  chooses (load server version / keep mine).
- **Seating preview** mirrors `@jpb/seating-engine` `computeTableCount` and
  `distributeSizes` (property-tested against the engine).
- **Prize split**: `amountᵢ = ⌊pool × bpᵢ ÷ 10,000 ÷ round⌋ × round`, the
  remainder to 1st place; exact BigInt arithmetic on integer minor units.
- Late registration needs both `lateRegistration.enabled` and
  `features.lateRegistration` (tournament-engine); the Registration step keeps
  the flag in sync with the toggle and the Spectators & features step warns on a
  mismatch.

## Contract notes

1. `POST /api/admin/tournaments` returns a `TournamentListItemDto` without the
   server seed hash; the wizard navigates to `/t/:id/setup` and shows the hash
   from the overview (`serverSeedHash`) in a "created" banner.
2. On `/tournaments/new` the shell's `TournamentScopeProvider` still names the
   last tournament opened (for the top bar), so `useCurrentTournamentId()` is not
   null there; the section uses `useParams().tournamentId` to decide create/edit.
