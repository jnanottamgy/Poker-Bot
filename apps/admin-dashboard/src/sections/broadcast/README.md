# Broadcast & announcements (§2.14)

Messages to players and control of the big screen. Deterministic text only — every message is
typed by staff or comes from a fixed template; nothing is generated (docs/NO_AI.md).

## Announcements (`Composer.tsx`)

- **Audience:** Everyone (`ALL`), One table (`TABLE` + table id), One player (`PLAYER` + player
  id), Big screen (`DISPLAY`) → `POST /tournaments/:id/announce { text, scope, targetId? }`
  (ANNOUNCE, level 1: one confirmation listing the recipients; audited by the server).
- **Pickers** (`TargetPicker.tsx`): WAI-ARIA comboboxes that ask the server for matching tables
  (number prefix, `tables?q=`) or players (name / nickname / public id, `players?q=`, from 2
  characters), 8 suggestions — never a list of all tables or players.
- **Templates** (`templates.ts`): grouped (General, Clock, Milestones, Table, Player), with
  named placeholders (`{remaining}`, `{blinds}`, `{leader}`, `{table}`, `{player}`, …) filled
  from the server's state. A template whose data is missing is disabled with "needs …"; a
  template that needs a target re-fills when the target is picked (unless the text was edited).
  Text is limited to 280 characters (server zod limit) with a live counter; unfilled `{…}`
  placeholders, an empty text or a missing target block sending with a clear message.
- **Preview:** a big-screen banner (ALL / DISPLAY) or the player's private notice card.

## Commentary (`Activity.tsx`)

`commentaryFor(event)` turns one live tournament event into one fixed sentence in the forms of
CONTRACTS.md ("{PLAYER} has been eliminated in {POS}", "{N} players remain", "Final table
reached", level changes, breaks, table breaks, hand-for-hand, milestones, champion). Same event →
same sentence. "Use" puts it in the composer (everyone or big screen).

The **announcement log** reads the audit log (`ANNOUNCE` entries: sender, time, scope, text)
with AUDIT_VIEW; without it, it shows this session's sent messages and the live ANNOUNCEMENT
events.

## Broadcast display (`DisplayControl.tsx`)

- `POST /tournaments/:id/display { scene, featuredTableId }` (ANNOUNCE, level 0: applied
  immediately, audited by the server). Scenes: Overview, Leaderboard, Final table, Announcement,
  Champion (disabled until the tournament is COMPLETED). Featured table: table picker, plus a
  one-click "Feature the final table" at the final table.
- **Preview link:** the display app is served at **`/display/?t=<tournamentId>`** (same origin
  as the control room): "Open display" (new tab) and "Copy display link".
- **Milestone splash:** fixed milestone templates (final table, in the money, bubble, players
  remain, heads-up, champion) → one level-1 confirmation, then `announce(scope DISPLAY)` and
  `display(scene ANNOUNCEMENT)`.

## Contract notes

1. There is no GET for the display state (scene, featured table). The screen shows what this
   console last applied, else the last `DISPLAY_SCENE` audit entry (who / when; the game server
   audits the director input, which has the featured table but not the scene). Suggested:
   `display: { scene, featuredTableId, updatedAt }` in `TournamentOverviewDto` (or a GET).
2. `scope: DISPLAY` is delivered by the game server exactly like `ALL` (Johnny's ANNOUNCE →
   tournament-wide ANNOUNCEMENT event), so players see big-screen announcements too. The UI says
   so in the audience hint and the splash confirmation.
3. Display URL: this screen uses `/display/?t=<tournamentId>` (as agreed for the display app);
   docs/DEPLOYMENT.md still mentions `/display/<JOINCODE>` — one of the two needs updating.
4. `DisplayScene` in `api/types.ts` also lists `FEATURED_TABLE`; §2.14 names five scenes, so the
   featured table is offered as a parameter of every scene rather than a sixth scene.
5. The splash is two requests (announce, then scene). If the scene change fails, the dialog shows
   the error and "retry" only re-applies the scene — the announcement is never sent twice.
