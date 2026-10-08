import type { Repos, Store } from '../persistence/store';

/**
 * The unit of work the actor host commits per command. With PostgreSQL it is
 * one database transaction; the in-memory variant (unit tests, benchmarks)
 * emulates rollback through `onRollback` undo hooks.
 */
export interface ActorTransaction {
  /** Repositories bound to the transaction (throws in memory mode). */
  readonly repos: Repos;
  /** Undo hook for non-database writes, run in reverse order if the unit of work fails. */
  onRollback(undo: () => void): void;
}

export interface TransactionRunner {
  run<T>(fn: (tx: ActorTransaction) => Promise<T>): Promise<T>;
}

async function withUndo<T>(exec: (fn: (repos: Repos) => Promise<T>) => Promise<T>, fn: (tx: ActorTransaction) => Promise<T>): Promise<T> {
  const undo: Array<() => void> = [];
  try {
    return await exec((repos) => fn({ repos, onRollback: (u) => undo.push(u) }));
  } catch (err) {
    for (const u of undo.reverse()) u();
    throw err;
  }
}

/** One PostgreSQL transaction per unit of work (spec §63: all-or-nothing). */
export function storeTransactions(store: Pick<Store, 'transaction'>): TransactionRunner {
  return { run: (fn) => withUndo((inner) => store.transaction((repos) => inner(repos)), fn) };
}

const noDatabase = new Proxy({} as Repos, {
  get(_target, prop) {
    throw new Error(`No database in in-memory mode (accessed repos.${String(prop)})`);
  },
});

export interface MemoryTransactionRunner extends TransactionRunner {
  /** Makes the next unit of work fail (after its writes) with `err` — failure injection for tests. */
  failNext(err?: Error): void;
}

export function memoryTransactions(): MemoryTransactionRunner {
  let pendingFailure: Error | null = null;
  return {
    failNext(err = new Error('injected transaction failure')) {
      pendingFailure = err;
    },
    run: (fn) =>
      withUndo(async (inner) => {
        const result = await inner(noDatabase);
        if (pendingFailure) {
          const err = pendingFailure;
          pendingFailure = null;
          throw err;
        }
        return result;
      }, fn),
  };
}
