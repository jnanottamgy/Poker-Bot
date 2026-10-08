# @jpb/ui — Johnny's Poker Bot design system

React 19 components, hooks, pure formatters and a single plain-CSS stylesheet
for the player app (phones), the admin control room (desktop/tablet) and the
projector display.

```ts
import '@jpb/ui/styles.css';
import { ActionPanel, PokerTable, formatChips } from '@jpb/ui';
```

Add `class="jpb-app"` to `<body>` (or the app root) for the base typography,
background and zero-specificity resets.

- **No dependencies** beyond React and `@jpb/shared-types`. No CSS framework, no
  CSS-in-JS. Every class is prefixed `jpb-`.
- **Server is the authority.** Components display server state and send
  intentions only. `ActionPanel` is driven only by `LegalActions`; timers are
  visual only (`remainingMs` uses the estimated server clock offset).
- **Never colour alone.** Every status has an icon *and* text; every state of a
  seat has a text form; screen readers get full labels ("Ace of spades",
  "Stack 12,450 chips").

## Visual direction

Simple, elegant, energetic. Deep charcoal layers, off-white text, one electric
green for positive actions and the player to act, blue for information, gold
reserved for milestones / the final table / the champion, red only for danger.
Clean white card faces. Subtle motion that never delays gameplay. Inter / system
sans with tabular numerals for chips and clocks.

Gallery: `npx vite packages/ui/gallery` (every component in every important
state, with toggles for high contrast, the four-colour deck and reduced motion).
Screenshots: `node packages/ui/gallery/screenshot.mjs [section…]` writes
`gallery/screenshots/<section>-{mobile,desktop}.png` (390×844 and 1440×900, plus
the raise sizer open and a high-contrast table).

## Tokens (`:root` custom properties)

| Group | Tokens |
| --- | --- |
| Layers | `--jpb-bg`, `--jpb-bg-raised`, `--jpb-surface`, `--jpb-surface-2`, `--jpb-elevated`, `--jpb-elevated-2`, `--jpb-border`, `--jpb-border-strong`, `--jpb-border-heavy`, `--jpb-scrim` |
| Text | `--jpb-text` (off-white), `--jpb-text-2`, `--jpb-text-muted`, `--jpb-text-inverse` |
| Meaning | `--jpb-accent` (+`-strong`, `-ink`, `-soft`, `-line`, `-glow`), `--jpb-info*`, `--jpb-gold*`, `--jpb-danger*`, `--jpb-warning*`, `--jpb-neutral-soft/-line` |
| Table | `--jpb-felt`, `--jpb-felt-center`, `--jpb-felt-edge`, `--jpb-felt-line`, `--jpb-rail`, `--jpb-rail-edge`, `--jpb-chip` |
| Cards | `--jpb-card-face`, `--jpb-card-edge`, `--jpb-card-black`, `--jpb-card-red`, `--jpb-card-{spades,clubs,hearts,diamonds}`, `--jpb-card-back`, `--jpb-card-back-line` |
| Spacing | `--jpb-space-{0,1,2,3,4,5,6,8,10,12,16}` (4px grid) |
| Radii | `--jpb-radius-{xs,sm,md,lg,xl,2xl,pill}` |
| Type | `--jpb-font-sans`, `--jpb-font-display`, `--jpb-font-mono`, `--jpb-fs-{xs,sm,base,md,lg,xl,2xl,3xl,huge}`; semantic hierarchy `--jpb-type-huge` (major events) > `--jpb-type-large` (stacks) > `--jpb-type-medium` (names) > `--jpb-type-small` (metadata, never critical info); `--jpb-weight-*` |
| Elevation | `--jpb-shadow-{1,2,3}`, `--jpb-glow-{accent,gold,danger}`, `--jpb-focus-ring` |
| Motion | `--jpb-dur-{instant,fast,base,slow,slower,cinematic}`, `--jpb-ease-{out,in-out,spring}` |
| Layers (z) | `--jpb-z-{base,raised,sticky,dropdown,overlay,modal,toast,champion,skip}` |
| Touch | `--jpb-touch` (48px minimum target) |

### Theme switches (attributes on any ancestor, usually `<html>`)

- `data-contrast="high"` — pure black, white text, opaque borders, brighter
  accents, yellow focus ring, folded seats faded less.
- `data-deck="four-color"` — clubs green, diamonds blue (suits also differ by
  glyph and spoken label).
- `data-motion="reduced"` — same as the OS `prefers-reduced-motion: reduce`:
  every `jpb-` animation/transition is reduced to a single instant frame,
  duration tokens become 0, `useReducedMotion()` returns true and
  `useAnimatedNumber` jumps straight to the value.
- `.jpb-stale` / `data-stale="true"` — greys out an area that is not live
  (use with `ConnectionBanner` while disconnected).

## Formatters (`src/format.ts`, pure)

| Function | Behaviour |
| --- | --- |
| `formatChips(n)` | `10000 → "10,000"` (en-US grouping on every device). |
| `formatChipsCompact(n)` | `999 → "999"`, `12500 → "12.5K"`, `125000 → "125K"`, `1250000 → "1.2M"`. **Rounding rule:** truncate toward zero to one decimal of the unit, never round. A compact stack never overstates the real stack and never jumps a unit: `999,950 → "999.9K"`, `1,999 → "1.9K"`. Pair with the exact value (title / tap). |
| `formatChipsDelta(n)` | `+1,200`, `-500`, `0`. |
| `formatMoneyMinor(minor, currency='INR')` | Intl currency from integer minor units. INR uses `en-IN` grouping (`10000000 → "₹1,00,000"`); whole amounts drop `.00`, fractional amounts show all minor digits; zero-decimal currencies respected. |
| `formatClock(ms)` | Seconds rounded **up** (shows `00:00` only when nothing is left): `271000 → "04:31"`, `3725000 → "1:02:05"`. |
| `cardLabel('As')` | `"Ace of spades"`; `rankDisplay('T') → "10"`; `cardShort('Td') → "10♦"`; `parseCard`, `suitName`, `suitGlyph`, `isRedSuit`. |
| others | `formatCount`, `formatOrdinal` (`184 → "184th"`), `formatPercent`, `secondsLeft`, `initials`. |

## Action logic (`src/actionLogic.ts`, pure)

`ActionPanel` never computes legality; it maps `LegalActions` to controls.

- Passive slot: `CHECK` when `canCheck`, else `CALL <callAmount>`; a call with
  `callAmount >= stack` is labelled **ALL-IN** as well.
- Aggressive slot: `BET` when `canBet` (unopened), `RAISE` when `canRaise`; the
  sizer opens only when a range exists (`minTo < maxTo`). If all-in is the only
  aggressive option a single `ALL-IN <allInTo>` button is shown.
- **Preset formula** (`raisePresets`):
  `base = currentBet > 0 ? currentBet : bigBlind`;
  Min = `minTo`; 2x / 2.5x / 3x = `clamp(round(m × base))`; All-in = `maxTo`;
  `clamp(x) = min(maxTo, max(minTo, x))`. Facing a bet the multipliers mean
  "raise to N× the current bet"; unopened they mean "bet N big blinds".
  Presets that were clamped are announced as "(limited by table rules)".
- Slider snaps to half-big-blind steps but min and max are always reachable;
  the number field is clamped on blur/Enter; ± steppers move one big blind.
- Intents: BET/RAISE carry `amount` = the **total** street contribution ("to"),
  per the protocol. Choosing `maxTo` sends `{ type: 'ALL_IN' }`.

## Hooks

| Hook | Notes |
| --- | --- |
| `useServerCountdown(deadline, serverOffsetMs, { intervalMs?, now? })` | Remaining ms to a server deadline; pure core `remainingMs(deadline, clientNow, offset) = max(0, deadline − (clientNow + offset))` where `offset = serverNow − clientNow`. Interval-based (200ms default), stops at 0. |
| `useReducedMotion()` | OS media query **or** `<html data-motion="reduced">`, live-updating. |
| `useAnimatedNumber(value, durationMs=450)` | Short ease-out count; exact final frame; instant under reduced motion. |
| `useHaptics(enabled)` | `vibrate(pattern)` only if `navigator.vibrate` exists **and** the user enabled it. Patterns: tap, your-turn, warning, elimination, success. |
| `useSound(initialMuted = true)` | Web Audio synthesized cues (deal, your-turn, timer-warning, elimination, big-pot, final-table), each < 1.2s and quiet. **Muted by default**; no AudioContext is created until unmuted (unmuting is a user gesture, satisfying autoplay rules). No audio files. |

## Components and accessibility

| Component | Accessibility / behaviour |
| --- | --- |
| `Button` | Variants primary / secondary / danger / ghost / gold; sizes sm 36, md 44, lg 52, xl 64px. `loading` shows a spinner + "Submitting…", sets `aria-busy` and disables. `shortcut` renders a hidden-from-AT `<kbd>` hint and sets `aria-keyshortcuts`; hints hide on touch/narrow screens. |
| `IconButton` | Required `label` (aria-label + tooltip); `pressed` → `aria-pressed`. |
| `Icon` | Inline stroke SVG set, always `aria-hidden` — meaning is carried by adjacent text. |
| `PlayingCard` | `role="img"` with "Ace of spades" (", winning card" when highlighted); face-down cards never contain the face. Sizes xs/sm/md/lg/xl; `deal`, `flip`, `delayMs`, `highlight`, `dimmed`. |
| `Board` | Five slots, placeholders for missing cards, group label "Board: …". Only newly added cards animate (staggered flip). |
| `HoleCards` | Group label "Your cards: Ace of hearts and King of hearts"; fanned hero style; folded dimming. |
| `StackDisplay` | Compact by default; tap/click toggles exact (`aria-pressed`); exact amount always in title and spoken name; optional BB count. |
| `PotDisplay` | Count-up on growth plus a soft bump; side pots listed (and spoken). |
| `ActionTimer` | `role="timer"` ring + seconds. ≤ 5s: colour change **and** the text cue "HURRY". Assertive live region says "10 seconds left" / "5 seconds left" exactly once per deadline (`announce` for the hero only). |
| `BlindClock` | Level, blinds/ante, "Next level in 04:31"; break ("Break ends in"), paused ("Clock paused", frozen time) states in text; compact / full / broadcast variants; full sentence for screen readers. |
| `PlayerSeat` | Self-contained pod (nothing floats over neighbours): name, stack, D/SB/BB badges (spoken "dealer button"…), FOLDED, ALL-IN, AWAY, DISCONNECTED (short "OFFLINE" on mobile pods), "TO ACT" flag + glow + timer ring, last action chip, shown cards, "WINNER +12.4K", hand description. One complete `aria-label` per seat. `seatPropsFromView(PublicSeatView)` maps server views. |
| `PokerTable` | 2–10 seats, clockwise from the hero at bottom-centre (`seatLayout`, tested). **wide**: landscape oval, bets on the felt. **tall** (mobile): portrait felt, narrow pods on the rail, smaller board, bets inside pods, hero in a large dock under the felt with big cards, stack/BB, timer and a "YOUR TURN" flag. `variant="auto"` switches at 640px of *container* width (CSS container query), with a further step at 350px. Empty seats are spoken ("Seat 7 empty"). `finalTable` adds the gold rail. |
| `ActionPanel` | See action logic. Locks itself after one intent (double clicks / key repeats send exactly one) until `legal` changes or `pending` goes true → false; `pending` disables everything with "Submitting…". Keyboard: F fold, C check/call, R/B bet/raise (Enter confirms, Esc cancels), A all-in; ignored while typing or with modifiers. Optional `confirmAllIn` second step (`alertdialog`). 60px buttons; amounts on a second line so "CALL 1,250,000" never truncates. |
| `YourTurnBanner` | "YOUR TURN" + detail (`role="status"`) + timer. |
| `ConnectionBanner` | connected → renders nothing. reconnecting: "RECONNECTING… / Your chips are safe. Tournament continues on the server." offline (Retry) and session-replaced ("Use this device") use `role="alert"`. `staleForSeconds` prints "Not live — last update 12s ago". Copy is exported as `CONNECTION_COPY`. |
| `TableMoveCard` | "♠ TABLE CHANGE — You have been moved", FROM/TO with 1-based seats (props are 0-based `SeatIndex`), stack, Continue focused on mount (`alertdialog`). |
| `EliminationCard` | "YOU'RE OUT", finish #, field size, ties, hands played, prize (gold when in the money), Watch tournament. |
| `ChampionOverlay` | Gold trophy, CHAMPION sheen, name, 1ST PLACE, stack, players, prize; slow bloom/rings that become static under reduced motion. `role="dialog"`; `position="inline"` for embedding. |
| `MilestoneBanner` | Gold, icon + text, `role="status"`; md / lg / broadcast sizes. |
| `Leaderboard` | Visible, explicit mode label: "Current stack ranking" vs "Finishing positions" (also the table caption, so a live ranking is never mistaken for a result). Highlights "YOU". |
| `TournamentStatus`, `TournamentStatusPill` | Status pill (icon + text for every `TournamentStatus`, see `TOURNAMENT_STATUS_META`) + players remaining / total + tables + level (+ avg stack, hand-for-hand). |
| `StatusPill`, `Badge` | Label text is required; icon optional; `live` dot. Badges accept a spoken long form (`srLabel`). |
| `Alert` | INFO / WARNING / CRITICAL / SUCCESS with icon and the severity word; CRITICAL is `role="alert"`, others `role="status"`. |
| `Modal` | `role="dialog"`, `aria-modal`, labelled/described, focus trap (Tab wraps), Esc closes when `dismissible`, focus restored to the opener, body scroll locked, center or right-drawer placement, portal (or `inline`). |
| `ConfirmDialog` | **Double confirmation** for dangerous admin operations: open the dialog, then type the exact (case-sensitive) word **and** give a reason (min length, trimmed, sent to the audit log). Shows consequences and a before → after table. Confirm stays disabled until both are valid; Enter cannot bypass; pending shows "Submitting…" and blocks dismissal. |
| `Toast`, `ToastProvider`, `useToast()` | Polite live region; danger toasts are `role="alert"` and sticky by default; optional action. |
| `EmptyState`, `ErrorState` | Friendly copy; `ErrorState` deliberately has no prop for an Error object (no stack traces), only an optional short reference id. |
| `Spinner`, `Skeleton` | Spinner can carry a status label; skeletons are `aria-hidden`. |
| `Tabs` | WAI-ARIA tabs (roving tabindex, Arrow/Home/End), underline or segmented, optional counts. |
| `TextField`, `TextArea`, `Select`, `SearchInput`, `Toggle` | Real labels, hint/error via `aria-describedby`, `aria-invalid`, error text with icon; native select; search clears with Esc and announces a result summary; `Toggle` is `role="switch"` with visible ON/OFF. |
| `ProgressBar` | `role="progressbar"` with `aria-valuetext`. |
| `DataTable` | Sticky header, sortable columns (`aria-sort`), keyboard rows (Tab, Enter/Space, ↑/↓), selected row, loading skeleton, empty state, pagination footer ("1–12 of 2,000", page x of y). Controlled or uncontrolled sort. |
| `StatTile`, `Sparkline` | KPI with label, value, unit, delta (arrow + text + context, good/bad tone), optional sparkline; sparkline can carry an accessible summary. |
| `TableTile`, `TableMap` | Table number, seat fill, players/max, hand #, average stack, status icon + text (ACTIVE / IDLE / HELD / BREAKING / STALLED / CLOSED), health icon + text, alert count, featured (final) table. Fixed tile height (`TABLE_TILE_HEIGHT`) so the map windows itself (only visible rows in the DOM; on by default above 120 tables), status legend with counts. `tableMapMetrics(width)` exposes the grid maths. |
| `AdminShell` | Skip link, grouped sidebar navigation with count badges and `aria-current`, top bar (title, live status, actions, user + role), optional global banner, `<main>`. Collapses to an icon rail automatically below 1100px; the toggle forces either state. |
| `Panel`, `ControlCard`, `DescriptionList`, `ActivityFeed` | Control-room building blocks. `ControlCard` shows a live state line and disables its controls (fieldset) when `lockedPermission` is set, naming the missing permission ("Requires STACK_ADJUST") — the server still enforces it. `ActivityFeed` renders audit events with actor, action code, target and quoted reason. |
| `Kbd` | `<kbd>` key hint. |

## Tests

`npx vitest run --project ui packages/ui` — formatters (exhaustive, including a
sweep proving compact chips never overstate), `remainingMs` and the countdown
hook, action logic (labels, presets, clamping, snapping, intents), ActionPanel
(check vs call, call all-in, bet vs raise, raise not allowed, all-in only,
presets clamped, typed amounts clamped, double-submit prevention, pending,
unlock rules, keyboard shortcuts, confirm-all-in), ConfirmDialog (cannot confirm
without both the typed word and a reason), PlayingCard labels for all 52 cards,
StatusPill/table/tournament statuses always render text, ConnectionBanner copy
per state, Leaderboard mode labels, seat geometry, Modal focus trap, DataTable,
Tabs, Toggle, TableMap windowing, toasts, hooks.

## Contract notes

- Seat numbers shown to humans are `SeatIndex + 1`; components that take seats
  (`TableMoveCard`, `PlayerSeat`, `PokerTable`) accept 0-based `SeatIndex`.
- `PokerTable` reads `bet` (street contribution) per seat; map it from
  `PublicSeatView.streetContribution`.
