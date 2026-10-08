# Legal and event-configuration boundaries

> This is an engineering note, not legal advice. Have the event structure
> reviewed by counsel for each jurisdiction and institution where it runs.

## What the software does and does not do

- The game engine uses **virtual tournament chips only**. Chips have no cash
  value, cannot be bought, sold, transferred or withdrawn, and are never
  converted into money by the software.
- There is **no wallet, balance, deposit, withdrawal or transfer** concept
  anywhere in the code (spec §94).
- Prizes are a **fixed table configured before the tournament starts** and
  locked at start (spec §93). The engine maps a finishing position to that
  configured prize; it never computes prizes from poker outcomes or pools.
- Prize payment is an **administrative record** (UNPAID / PROCESSING / PAID,
  who processed it, when, reference). The software does not move money.
- Entry fees are **not collected** by the software. If an organizer charges one
  outside the platform, that is the organizer's legal responsibility.

## Configuration boundaries

Organizers control, per tournament:

| Setting | Purpose |
| --- | --- |
| Registration fields | Collect only what the event needs (name by default) |
| Access code | Restrict joining to people physically at the venue |
| Approval required | Staff approve each registration (e.g. ID check) |
| Prize structure | Optional; may be non-monetary (trophies, merchandise) |
| Spectators | Public watching on/off, delay |

## Points organizers in India should check (status as understood in 2026)

- The **Promotion and Regulation of Online Gaming Act, 2025** prohibits
  offering, operating and advertising *online money games* — games played by
  depositing money or stakes in expectation of winnings — irrespective of
  whether they are games of skill or chance, while promoting e-sports and
  online social games. A tournament that takes entry fees or stakes and pays
  winnings over an online platform is squarely the activity this law targets.
  Free-entry tournaments with virtual chips are the configuration the
  software is built for; confirm with counsel how sponsor-funded prizes are
  treated before offering any.
- State gaming/gambling laws (and the Public Gambling Act, 1867 where
  applicable) govern in-person events with stakes.
- If any prize is awarded: tax treatment of winnings (e.g. TDS provisions
  applicable to winnings from games/contests), GST on any consideration
  collected, and record-keeping. The payout export (Admin → Payouts → CSV)
  is designed to support this bookkeeping.
- Educational institutions often have their own policies on card games and
  prizes; get written approval.

## Data protection

The platform collects the minimum personal data (configurable), never shows
contact details or IDs to other players, restricts PII to admins with the
`PLAYER_VIEW_PII` permission, and keeps an audit log of administrative access
to sensitive operations. Organizers remain the data fiduciary for what they
collect (Digital Personal Data Protection Act, 2023): state the purpose at
registration, retain data only as long as needed, and delete tournament data
when no longer required.
