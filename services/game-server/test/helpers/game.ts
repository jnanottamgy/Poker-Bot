import type { ActionType, LegalActions, TournamentPublicSummary } from '@jpb/shared-types';
import { simulationConfig } from '@jpb/simulation';
import type { TournamentConfig } from '@jpb/shared-types';
import { LocalBus } from '../../src/bus/local-bus';
import { Store } from '../../src/persistence/store';
import type { Database } from '../../src/persistence/db';
import { createGameRuntime } from '../../src/game/wiring';
import type { GameRuntime } from '../../src/game/wiring';
import type { TableUpdateMessage } from '../../src/runtime/contracts';
import type { DirectorTable } from '@jpb/tournament-engine';
import { RegistrationService } from '../../src/services/registration';

export const TEST_SEED_KEY = 'a'.repeat(64);

export interface GameFixture {
  store: Store;
  bus: LocalBus;
  rt: GameRuntime;
  registration: RegistrationService;
  restart(): Promise<void>;
  stop(): Promise<void>;
}

export async function startGame(db: Database, opts: { nodeId?: string; verifyOnRecovery?: boolean; snapshotEvery?: number } = {}): Promise<GameFixture> {
  const store = new Store(db);
  const bus = new LocalBus();
  const make = () =>
    createGameRuntime({
      env: { nodeId: opts.nodeId ?? 'node-1', role: 'all', redisUrl: null, snapshotEveryCommands: opts.snapshotEvery ?? 25, seedEncryptionKey: TEST_SEED_KEY },
      store,
      bus,
      nodeOverrides: { verifyOnRecovery: opts.verifyOnRecovery ?? true, leaseTtlMs: 3000, leaseRenewMs: 500, rebalanceIntervalMs: 500, catalogGraceMs: 2000 },
      dispatcher: { sweepMs: 100 },
    });
  const fx: GameFixture = {
    store,
    bus,
    rt: make(),
    registration: undefined as unknown as RegistrationService,
    async restart() {
      await fx.rt.stop();
      fx.rt = make();
      fx.registration = new RegistrationService(store, fx.rt.game);
      await fx.rt.start();
    },
    async stop() {
      await fx.rt.stop();
    },
  };
  fx.registration = new RegistrationService(store, fx.rt.game);
  await fx.rt.start();
  return fx;
}

export function fastConfig(players: number, overrides: Partial<TournamentConfig> = {}): TournamentConfig {
  const base = simulationConfig(players);
  return { ...base, joinCode: 'E2E0001', ...overrides };
}

/** Deterministic, aggressive policy so tournaments end quickly (no Math.random). */
export function chooseAction(legal: LegalActions, salt: number): { type: ActionType; amount?: number } {
  const r = salt % 7;
  if (r <= 2 && legal.canAllIn) return { type: 'ALL_IN' };
  if (r === 3 && legal.canRaise) return { type: 'RAISE', amount: legal.minTo };
  if (r === 4 && legal.canFold && !legal.canCheck) return { type: 'FOLD' };
  if (legal.canCheck) return { type: 'CHECK' };
  if (legal.canCall) return { type: 'CALL' };
  if (legal.canAllIn) return { type: 'ALL_IN' };
  return { type: 'FOLD' };
}

/**
 * Plays every seat of every open table by polling table snapshots (what a
 * WebSocket client would receive) until the tournament completes.
 */
export async function playUntilComplete(fx: GameFixture, tournamentId: string, opts: { timeoutMs?: number; pollMs?: number; onTick?: (summary: TournamentPublicSummary) => Promise<void> | void } = {}): Promise<{ actions: number; rejected: number; summary: TournamentPublicSummary }> {
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  let actions = 0;
  let rejected = 0;
  let n = 0;
  for (;;) {
    const summary = (await fx.rt.game.tournamentSummary(tournamentId))!;
    if (summary.status === 'COMPLETED' || summary.status === 'CANCELLED') return { actions, rejected, summary };
    if (Date.now() > deadline) throw new Error(`tournament did not complete in time (status ${summary.status}, active ${summary.counters.active})`);
    await opts.onTick?.(summary);
    const tables = (await fx.rt.game.directorQuery<DirectorTable[]>(tournamentId, { q: 'TABLES' })) ?? [];
    await Promise.all(
      tables.map(async (t) => {
        const snap = await fx.rt.game.tableSnapshot(t.summary.tableId).catch(() => null);
        if (!snap) return;
        for (const [playerId, priv] of Object.entries(snap.privateByPlayer as TableUpdateMessage['privateByPlayer'])) {
          if (!priv.legal) continue;
          const intent = chooseAction(priv.legal, ++n + snap.version);
          const reply = await fx.rt.game
            .submitPlayerAction({ playerId, tableId: t.summary.tableId, actionId: `a${n}`, type: intent.type, ...(intent.amount !== undefined ? { amount: intent.amount } : {}), tableStateVersion: snap.publicView.hand?.turnVersion ?? 0, receivedAt: Date.now() })
            .catch(() => null);
          actions++;
          if (!reply?.ok) rejected++;
        }
      }),
    );
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 20));
  }
}
