import type { HandHistoryRecord } from '@jpb/table-engine';
import { deckLabel } from '@jpb/fairness-engine';
import type { Repos } from '../persistence/store';

/** Hand history projection (spec §58): browsable columns + the complete record + randomness metadata. */
export async function projectHand(repos: Repos, h: HandHistoryRecord, fairness: { serverSeedHash: string; publicEntropy: string }): Promise<void> {
  const randomness = {
    method: 'HMAC-SHA256-STREAM+FISHER-YATES',
    scheme: 'JPB/v1',
    serverSeedHash: fairness.serverSeedHash,
    publicEntropy: fairness.publicEntropy,
    deckHash: h.deckHash,
    label: deckLabel({ tournamentId: h.tournamentId, tableId: h.tableId, handNumber: h.handNumber, publicEntropy: fairness.publicEntropy }),
  };
  await repos.hands.insert(h, randomness);
}
