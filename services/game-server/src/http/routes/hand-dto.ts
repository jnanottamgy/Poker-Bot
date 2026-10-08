import type { HandActionDto, HandDetailDto, HandListItemDto } from '@jpb/shared-types';
import type { HandHistoryRecord } from '@jpb/table-engine';
import type { Repos } from '../../persistence/store';
import type { HandRow } from '../../persistence/repos/hands';

/** Hand list rows with winners and their display names (two queries per page, never per row). */
export async function handListItems(repos: Repos, rows: HandRow[]): Promise<HandListItemDto[]> {
  const winners = await repos.hands.winnersOf(rows.map((r) => r.handId));
  const ids = [...new Set([...winners.values()].flat().map((w) => w.playerId))];
  const names = new Map<string, string>();
  if (ids.length) {
    const r = await repos.q.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM players WHERE id = ANY($1)`, [ids]);
    for (const row of r.rows) names.set(row.id, row.display_name);
  }
  return rows.map((h) => ({
    handId: h.handId,
    tableId: h.tableId,
    tableNumber: h.tableNumber,
    handNumber: h.handNumber,
    startedAt: h.startedAt,
    completedAt: h.completedAt,
    level: h.level,
    smallBlind: h.smallBlind,
    bigBlind: h.bigBlind,
    totalPot: h.totalPot,
    players: h.playerCount,
    showdown: h.showdown,
    allIn: h.allIn,
    winners: (winners.get(h.handId) ?? []).map((w) => ({ playerId: w.playerId, displayName: names.get(w.playerId) ?? w.playerId, amount: w.amount })),
  }));
}

/** Complete hand detail for admins (all hole cards) built from the stored history record. */
export function handDetail(row: HandRow, h: HandHistoryRecord, randomness: Record<string, unknown>): HandDetailDto {
  const bySeat = new Map(h.players.map((p) => [p.seat, p]));
  const name = (seat: number) => bySeat.get(seat)?.displayName ?? `Seat ${seat + 1}`;
  const stacks = new Map(h.players.map((p) => [p.seat, p.startingStack]));
  let pot = 0;
  const actions: HandActionDto[] = h.actionLog.map((a, i) => {
    stacks.set(a.seat, (stacks.get(a.seat) ?? 0) - a.amount);
    pot += a.amount;
    return {
      seq: i + 1,
      street: a.street,
      seat: a.seat,
      playerId: a.playerId,
      displayName: name(a.seat),
      action: a.kind === 'ACTION' ? a.action : a.betType === 'SMALL_BLIND' ? 'POST_SB' : a.betType === 'BIG_BLIND' ? 'POST_BB' : 'POST_ANTE',
      amount: a.amount,
      toAmount: a.kind === 'ACTION' ? a.toAmount : a.amount,
      allIn: a.allIn,
      timeout: a.kind === 'ACTION' ? !!a.timeout : false,
      stackAfter: stacks.get(a.seat) ?? 0,
      potAfter: pot,
      at: h.completedAt,
    };
  });
  const evaluated = new Map(h.reveals.filter((r) => r.hand).map((r) => [r.seat, r.hand!]));
  const winnersBySeat = new Map<number, number>();
  for (const p of h.pots) for (const w of p.winners) winnersBySeat.set(w.seat, (winnersBySeat.get(w.seat) ?? 0) + w.amount);
  return {
    handId: row.handId,
    tableId: row.tableId,
    tableNumber: row.tableNumber,
    handNumber: row.handNumber,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    level: row.level,
    smallBlind: row.smallBlind,
    bigBlind: row.bigBlind,
    totalPot: row.totalPot,
    players: row.playerCount,
    showdown: row.showdown,
    allIn: row.allIn,
    winners: [...winnersBySeat.entries()].map(([seat, amount]) => ({ playerId: bySeat.get(seat)?.playerId ?? '', displayName: name(seat), amount })),
    buttonSeat: h.buttonSeat,
    smallBlindSeat: h.smallBlindSeat,
    bigBlindSeat: h.bigBlindSeat,
    ante: h.blinds.ante,
    board: [...h.board],
    boardByStreet: { flop: h.board.slice(0, 3), turn: h.board[3] ?? null, river: h.board[4] ?? null },
    seats: h.players.map((p) => {
      const ev = evaluated.get(p.seat);
      return {
        seat: p.seat,
        playerId: p.playerId,
        displayName: p.displayName,
        publicId: p.publicId,
        startingStack: p.startingStack,
        finalStack: p.finalStack,
        holeCards: p.holeCards,
        shown: p.shownCards !== null,
        finalHand: ev ? { category: ev.category, description: ev.description, bestFive: ev.bestFive } : null,
      };
    }),
    actions,
    pots: [...h.pots]
      .sort((a, b) => a.potIndex - b.potIndex)
      .map((p) => ({
        potIndex: p.potIndex,
        type: p.potType,
        amount: p.amount,
        eligibleSeats: p.eligibleSeats,
        winners: p.winners.map((w) => ({ seat: w.seat, playerId: w.playerId, amount: w.amount, oddChips: w.oddChips })),
        winningHand: p.winningHand ? { category: p.winningHand.category, description: p.winningHand.description } : null,
      })),
    uncalledReturns: h.uncalled ? [{ seat: h.uncalled.seat, amount: h.uncalled.amount }] : [],
    randomness: {
      method: 'HMAC-SHA256-STREAM+FISHER-YATES',
      serverSeedHash: String(randomness.serverSeedHash ?? ''),
      publicEntropy: String(randomness.publicEntropy ?? ''),
      deckHash: h.deckHash,
      label: String(randomness.label ?? ''),
    },
  };
}
