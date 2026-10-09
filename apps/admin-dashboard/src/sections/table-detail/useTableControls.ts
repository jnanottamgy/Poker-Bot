import { useMemo } from 'react';
import type { AdminTableView, CardCode } from '@jpb/shared-types';
import { formatChips, formatChipsDelta, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import type { HoleCardsRevealResponse } from '../../api/types';
import { useDangerousAction } from '../../danger/DangerProvider';
import { HOLD_REASON_LABEL } from '../tables/tableStatus';
import { seatLabel, stackInBB } from './model';
import type { SeatModel } from './model';

export interface MoveRequest {
  player: SeatModel;
  toTableId: string;
  toTableNumber: number;
  /** 0-based seat, or null to let the server pick the best seat by the seat-fairness score. */
  toSeat: number | null;
}

export interface AdjustRequest {
  player: SeatModel;
  newStack: number;
}

/** Message length the server accepts for announcements. */
export const MESSAGE_MAX_LENGTH = 280;
/** Extra decision time granted by the table's "add time" control. */
export const ADD_TIME_MS = 30_000;

/**
 * Every table control of §2.6 with its danger level (docs/API.md), copy,
 * consequences and before/after preview. All go through useDangerousAction;
 * results refresh the table from the server (never patched locally).
 */
export function useTableControls(tournamentId: string, tableId: string, view: AdminTableView | null, openTables: number | null) {
  const api = useApi();
  const danger = useDangerousAction();
  return useMemo(() => {
    const n = view?.tableNumber ?? 0;
    const players = view ? view.seats.filter(Boolean).length : 0;
    const invalidate = [qk.table(tableId), ['t', tournamentId, 'tables'] as const];
    const name = `table ${n}`;
    const acting = view?.hand?.actingSeat ?? null;
    const actingName = acting !== null ? (view?.seats[acting]?.displayName ?? seatLabel(acting)) : null;
    // The turn the operator is looking at: a timeout confirmed after it moved on is refused by the table.
    const turnVersion = view?.hand?.turnVersion ?? null;

    return {
      hold: () =>
        danger({
          level: 1,
          endpoint: 'tableHold',
          title: `Hold ${name}`,
          summary: 'The hand in progress finishes normally, then no new hand is dealt at this table until you release it.',
          consequences: ['Players see “Table on hold by the director”', 'The blind clock keeps running for the tournament', 'Other tables are not affected'],
          reason: 'optional',
          confirmLabel: 'Hold after this hand',
          run: ({ reason }) => api.tables.hold(tableId, reason ? { reason } : {}),
          success: `Table ${n} holds after the current hand`,
          invalidate,
        }),
      release: () =>
        danger({
          level: 1,
          endpoint: 'tableRelease',
          title: `Release ${name}`,
          summary: 'Removes your admin hold. The next hand is dealt as soon as no other hold remains.',
          consequences: view && view.holds.some((h) => h !== 'ADMIN') ? [`Still held by: ${view.holds.filter((h) => h !== 'ADMIN').map((h) => HOLD_REASON_LABEL[h]).join(', ')}`] : ['Play resumes with the next hand'],
          reason: 'optional',
          confirmLabel: 'Release table',
          run: ({ reason }) => api.tables.release(tableId, reason ? { reason } : {}),
          success: `Table ${n} released`,
          invalidate,
        }),
      freeze: () =>
        danger({
          level: 1,
          endpoint: 'tableFreeze',
          title: `Freeze ${name}`,
          summary: 'Stops this table instantly — even mid-hand. No action or timer is processed until you unfreeze it.',
          consequences: ['The acting player keeps their remaining action time', 'Players see “Table frozen by the director”', 'Only this table is affected'],
          reason: 'optional',
          tone: 'danger',
          confirmLabel: 'Freeze table now',
          run: ({ reason }) => api.tables.freeze(tableId, reason ? { reason } : {}),
          success: `Table ${n} frozen`,
          invalidate,
        }),
      unfreeze: () =>
        danger({
          level: 1,
          endpoint: 'tableUnfreeze',
          title: `Unfreeze ${name}`,
          summary: 'Actions and timers resume exactly where they stopped; the acting player gets back the time they had left.',
          reason: 'optional',
          confirmLabel: 'Unfreeze table',
          run: ({ reason }) => api.tables.unfreeze(tableId, reason ? { reason } : {}),
          success: `Table ${n} unfrozen`,
          invalidate,
        }),
      forceTimeout: () =>
        danger({
          level: 1,
          endpoint: 'tableForceTimeout',
          title: `Force timeout${actingName ? ` of ${actingName}` : ''}`,
          summary: `${actingName ?? 'The acting player'}${acting !== null ? ` (${seatLabel(acting)})` : ''} is timed out now: the server checks when possible, otherwise folds — exactly as if their timer expired.`,
          consequences: [
            'Counts as a timeout for the away rule (consecutive timeouts)',
            'Only this turn: if it moved on before you confirm, the server refuses and nobody else is timed out',
            'Written to the audit log with your reason',
          ],
          reason: 'required',
          tone: 'danger',
          confirmLabel: 'Force timeout',
          run: ({ reason }) => api.tables.forceTimeout(tableId, { reason, ...(turnVersion !== null ? { turnVersion } : {}) }),
          success: 'Timeout applied',
          invalidate,
        }),
      addTime: (ms = ADD_TIME_MS) =>
        danger({
          level: 1,
          endpoint: 'tableAddTime',
          title: `Give ${actingName ?? 'the acting player'} ${Math.round(ms / 1000)} more seconds`,
          summary: `The current decision's deadline moves by ${Math.round(ms / 1000)} s (e.g. a dispute or a connection problem at the table).`,
          consequences: ['Only the decision in progress gets the extra time', 'Written to the audit log'],
          reason: 'optional',
          confirmLabel: 'Add time',
          run: ({ reason }) => api.tables.addTime(tableId, { ms, ...(reason ? { reason } : {}) }),
          success: 'Time added',
          invalidate,
        }),
      breakTable: () =>
        danger({
          level: 2,
          endpoint: 'tableBreak',
          word: 'BREAK',
          title: `Break ${name}`,
          summary: 'Johnny moves every player at this table to the other tables (seat-fairness formula), then closes it.',
          consequences: [
            `${formatCount(players)} player${players === 1 ? '' : 's'} move to other tables — each after their current hand`,
            'Stacks travel with the players; chip conservation is checked on arrival',
            'The table closes for good once empty',
            'A BREAK_TABLE audit entry is written with your name and reason',
          ],
          preview: [
            { label: `Table ${n}`, before: view?.status === 'HELD' ? 'Held' : 'Open', after: 'Breaking → closed' },
            { label: 'Players at this table', before: formatCount(players), after: '0' },
            ...(openTables !== null ? [{ label: 'Open tables', before: formatCount(openTables), after: formatCount(Math.max(0, openTables - 1)) }] : []),
          ],
          confirmLabel: 'Break this table',
          run: (d) => api.tables.breakTable(tableId, d),
          success: `Table ${n} is breaking — players are being moved`,
          invalidate: [...invalidate, qk.tournament(tournamentId)],
        }),
      rebalance: () =>
        danger({
          level: 1,
          endpoint: 'tournamentRebalance',
          title: 'Rebalance tables now',
          summary: 'Johnny plans balancing moves for the whole tournament immediately (not only this table).',
          consequences: ['Players move from the largest tables to the smallest by the seat-fairness formula', 'Moves happen between hands, never mid-hand'],
          reason: 'optional',
          confirmLabel: 'Rebalance now',
          run: ({ reason }) => api.tables.rebalance(tournamentId, reason ? { reason } : {}),
          success: (r) => (r.movesPlanned > 0 ? `Rebalance planned ${formatCount(r.movesPlanned)} move${r.movesPlanned === 1 ? '' : 's'}` : 'Tables are already balanced'),
          invalidate: [qk.tournament(tournamentId), qk.table(tableId)],
        }),
      reveal: (onRevealed: (cards: Record<number, [CardCode, CardCode]>) => void) =>
        danger<HoleCardsRevealResponse, 'REVEAL'>({
          level: 2,
          endpoint: 'tableRevealHoleCards',
          word: 'REVEAL',
          title: `Reveal live hole cards at ${name}`,
          summary: 'Shows every seated player’s private cards to you, live. Use only for disputes and integrity investigations.',
          consequences: [
            'The cards are shown to you only — never to players, spectators or the big screen',
            'A REVEAL_HOLE_CARDS audit entry is written with your name, the hand number and your reason',
            'You can hide them again at any time; the audit entry stays',
          ],
          preview: [
            { label: 'Hole cards visible to you', before: 'Hidden', after: `${formatCount(players)} seat${players === 1 ? '' : 's'}` },
            ...(view?.hand ? [{ label: 'Hand', before: `#${formatCount(view.hand.handNumber)}`, after: `#${formatCount(view.hand.handNumber)} (revealed)` }] : []),
          ],
          confirmLabel: 'Reveal hole cards',
          run: (d) => api.tables.revealHoleCards(tableId, d),
          onSuccess: (r) => onRevealed(r.holeCards),
          success: 'Hole cards revealed — audit entry written',
          invalidate: [qk.table(tableId)],
        }),
      move: (m: MoveRequest) =>
        danger({
          level: 1,
          endpoint: 'playerMove',
          title: `Move ${m.player.name}`,
          summary: `From table ${n} ${seatLabel(m.player.seat).toLowerCase()} to table ${m.toTableNumber}, ${m.toSeat === null ? 'the best seat by the seat-fairness score' : seatLabel(m.toSeat).toLowerCase()}.`,
          consequences: [
            m.player.inHand && !m.player.folded ? 'The move happens when the current hand ends (never mid-hand)' : 'The move happens right away (not in a hand)',
            `The stack of ${formatChips(m.player.stack)} chips travels with the player`,
            'The seat-fairness score breakdown is recorded in the player’s movement history',
          ],
          reason: 'required',
          confirmLabel: 'Move player',
          run: ({ reason }) => api.players.move(m.player.playerId, { toTableId: m.toTableId, ...(m.toSeat !== null ? { toSeat: m.toSeat } : {}), reason }),
          success: `${m.player.name} will move to table ${m.toTableNumber}`,
          invalidate: [...invalidate, qk.table(m.toTableId), qk.player(m.player.playerId)],
        }),
      adjust: (a: AdjustRequest) => {
        const delta = a.newStack - a.player.stack;
        const bb = view?.blinds.bigBlind ?? 0;
        const bbText = (s: number) => {
          const x = stackInBB(s, bb);
          return x === null ? '' : ` (${x} BB)`;
        };
        return danger({
          level: 2,
          endpoint: 'playerAdjustStack',
          word: 'ADJUST',
          title: `Adjust ${a.player.name}’s stack`,
          summary: 'Corrects a stack after a verified error (e.g. a dealer miscount on camera). Applied between hands.',
          consequences: [
            `${formatChips(Math.abs(delta))} chips ${delta >= 0 ? 'added to' : 'removed from'} ${a.player.name} (${seatLabel(a.player.seat)})`,
            `The tournament’s expected chip total changes by ${formatChipsDelta(delta)} — chip conservation stays exact`,
            'An ADJUST_STACK audit entry records the before and after values with your reason',
          ],
          preview: [
            { label: 'Stack', before: `${formatChips(a.player.stack)}${bbText(a.player.stack)}`, after: `${formatChips(a.newStack)}${bbText(a.newStack)}` },
            { label: `Chips at table ${n}`, before: formatChips(view ? view.seats.reduce((s, x) => s + (x?.stack ?? 0), 0) + (view.hand?.totalPot ?? 0) : 0), after: formatChips((view ? view.seats.reduce((s, x) => s + (x?.stack ?? 0), 0) + (view.hand?.totalPot ?? 0) : 0) + delta) },
          ],
          confirmLabel: 'Adjust stack',
          run: (d) => api.players.adjustStack(a.player.playerId, { ...d, newStack: a.newStack }),
          success: `${a.player.name}’s stack set to ${formatChips(a.newStack)}`,
          invalidate: [...invalidate, qk.player(a.player.playerId), qk.overview(tournamentId)],
        });
      },
      message: (text: string) =>
        danger({
          level: 1,
          endpoint: 'announce',
          title: `Send a message to ${name}`,
          summary: `“${text}”`,
          consequences: [`Shown to the ${formatCount(players)} player${players === 1 ? '' : 's'} seated at table ${n}`, 'Recorded in the audit log'],
          reason: 'none',
          confirmLabel: 'Send message',
          run: () => api.broadcast.announce(tournamentId, { text, scope: 'TABLE', targetId: tableId }),
          success: `Message sent to table ${n}`,
        }),
    };
  }, [api, danger, tournamentId, tableId, view, openTables]);
}

export type TableControls = ReturnType<typeof useTableControls>;
