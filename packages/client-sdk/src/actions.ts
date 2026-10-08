import type { ActionType } from '@jpb/shared-types';
import { newActionId } from './random';
import type { GameStore, LastActionResult } from './store';

export interface SubmitInput {
  tableId: string;
  type: ActionType;
  amount?: number;
  tableStateVersion: number;
}

export type ActionOutcome = LastActionResult & { unknown?: boolean };

interface Pending {
  input: SubmitInput;
  actionId: string;
  resolve: (o: ActionOutcome) => void;
  timer: unknown;
}

/**
 * Submits player intentions with a unique actionId. Never optimistic: the
 * UI shows "Submitting…" until the server answers (spec §77). If the
 * connection drops, pending actions are re-sent with the SAME actionId after
 * reconnecting — the server processes each actionId at most once (spec §29),
 * so a retry can never double-act.
 */
export class ActionSubmitter {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly send: (msg: { t: 'action'; actionId: string; tableId: string; type: ActionType; amount?: number; tableStateVersion: number }) => boolean,
    private readonly store: GameStore,
    private readonly timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; now(): number },
    private readonly timeoutMs = 10_000,
  ) {}

  submit(input: SubmitInput): Promise<ActionOutcome> {
    for (const p of this.pending.values()) {
      if (p.input.tableId === input.tableId) {
        return Promise.resolve({ actionId: p.actionId, ok: false, code: null, message: 'An action is already being submitted.' });
      }
    }
    const actionId = newActionId();
    return new Promise<ActionOutcome>((resolve) => {
      const timer = this.timers.setTimeout(() => this.finish(actionId, { actionId, ok: false, code: 'TIMEOUT', message: 'No response yet — showing the latest table state.', unknown: true }), this.timeoutMs);
      this.pending.set(actionId, { input, actionId, resolve, timer });
      this.store.update({
        pendingAction: { actionId, tableId: input.tableId, type: input.type, amount: input.amount, sentAt: this.timers.now() },
      });
      this.transmit(actionId);
    });
  }

  /** Server answered. */
  onResult(actionId: string, ok: boolean, code: LastActionResult['code'], message: string | null): void {
    this.finish(actionId, { actionId, ok, code, message });
  }

  /** After a reconnect: re-send everything still pending (idempotent on the server). */
  resendPending(): void {
    for (const id of this.pending.keys()) this.transmit(id);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private transmit(actionId: string): void {
    const p = this.pending.get(actionId);
    if (!p) return;
    const { tableId, type, amount, tableStateVersion } = p.input;
    this.send({ t: 'action', actionId, tableId, type, tableStateVersion, ...(amount !== undefined ? { amount } : {}) });
  }

  private finish(actionId: string, outcome: ActionOutcome): void {
    const p = this.pending.get(actionId);
    if (!p) return;
    this.timers.clearTimeout(p.timer);
    this.pending.delete(actionId);
    const current = this.store.getState().pendingAction;
    this.store.update({
      pendingAction: current?.actionId === actionId ? null : current,
      lastActionResult: { actionId, ok: outcome.ok, code: outcome.code, message: outcome.message },
    });
    p.resolve(outcome);
  }
}
