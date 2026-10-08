import { decryptSecret, encryptSecret, parseEncryptionKey } from '../security/crypto';
import type { Store } from '../persistence/store';
import type { ActorLog } from '../runtime/actor-log';
import type { ActorTransaction } from '../runtime/transactions';
import type { LoggedCommand, LoggedEvent, Snapshot } from '../persistence/repos/logs';

/**
 * Server seeds are secret until the tournament completes. They live encrypted
 * (AES-256-GCM, AAD = tournament id) in `tournaments.server_seed_enc` and
 * decrypted only in process memory of nodes that host the tournament's actors.
 * Reducers need them synchronously, so the cache is filled before an actor
 * replays its log (see `withSeedPreload`).
 */
export class SeedService {
  private readonly key: Buffer;
  private readonly cache = new Map<string, string>();
  private readonly tableTournament = new Map<string, string>();

  constructor(
    private readonly store: Store,
    keyHex: string,
  ) {
    this.key = parseEncryptionKey(keyHex);
  }

  encrypt(tournamentId: string, seedHex: string): string {
    return encryptSecret(seedHex, this.key, tournamentId);
  }

  /** Remembers a seed generated in this process (tournament creation). */
  remember(tournamentId: string, seedHex: string): void {
    this.cache.set(tournamentId, seedHex);
  }

  /** Synchronous lookup for reducers. Throws if the seed was not preloaded (actor faults, never deals with a wrong seed). */
  seedFor(tournamentId: string): string {
    const s = this.cache.get(tournamentId);
    if (!s) throw new Error(`Server seed for ${tournamentId} is not loaded on this node`);
    return s;
  }

  async load(tournamentId: string): Promise<string | null> {
    const cached = this.cache.get(tournamentId);
    if (cached) return cached;
    const t = await this.store.repos.tournaments.get(tournamentId);
    if (!t) return null;
    const seed = decryptSecret(t.serverSeedEnc, this.key, tournamentId);
    this.cache.set(tournamentId, seed);
    return seed;
  }

  async loadForTable(tableId: string): Promise<void> {
    let tid = this.tableTournament.get(tableId);
    if (!tid) {
      const row = await this.store.repos.tableLogs.getTable(tableId);
      if (!row) return;
      tid = row.tournamentId;
      this.tableTournament.set(tableId, tid);
    }
    await this.load(tid);
  }

  /** Decrypts for the public reveal after completion (the seed is then published). */
  async reveal(tournamentId: string): Promise<string | null> {
    return this.load(tournamentId);
  }

  forget(tournamentId: string): void {
    this.cache.delete(tournamentId);
  }
}

/** Wraps an actor log so that recovery reads first make the actor's server seed available. */
export function withSeedPreload<M>(log: ActorLog<M>, preload: (actorId: string) => Promise<void>): ActorLog<M> {
  const wrapped: ActorLog<M> = {
    append: (tx: ActorTransaction, actorId: string, command: LoggedCommand, events: LoggedEvent[], meta: M) => log.append(tx, actorId, command, events, meta),
    saveSnapshot: (tx: ActorTransaction, actorId: string, snapshot: Snapshot) => log.saveSnapshot(tx, actorId, snapshot),
    latestSnapshot: async (actorId: string) => {
      await preload(actorId);
      return log.latestSnapshot(actorId);
    },
    commandsAfter: async (actorId: string, afterSeq: number, limit: number) => {
      await preload(actorId);
      return log.commandsAfter(actorId, afterSeq, limit);
    },
  };
  if (log.eventsAfter) wrapped.eventsAfter = (actorId, afterSeq, limit) => log.eventsAfter!(actorId, afterSeq, limit);
  return wrapped;
}
