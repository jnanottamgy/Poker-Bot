import type { GatewayBackend } from '../runtime/contracts';
import type { ClaimResult, ControllerRecord, PresenceStore } from './presence';

/**
 * ONE CONTROLLER PER PLAYER (spec §70) and connection presence for the table
 * actor's away logic.
 *
 * - The controller key lives in the PresenceStore (shared across nodes).
 * - `connected=true` is reported when a node gains the player's controller;
 *   `connected=false` only after the controller has been gone for the whole
 *   debounce window AND no controller exists anywhere (another node may have
 *   picked the player up), so a page refresh never flaps the away state.
 */
interface PendingDisconnect {
  timer: NodeJS.Timeout | undefined;
  done: Promise<void>;
  /** Report now (unless a controller exists somewhere). */
  run(): Promise<void>;
  /** Drop without reporting (the player came back). */
  cancel(): void;
}

export class ControllerManager {
  private readonly pendingDisconnects = new Map<string, PendingDisconnect>();
  private readonly reportedConnected = new Set<string>();

  constructor(
    private readonly presence: PresenceStore,
    private readonly backend: GatewayBackend,
    private readonly nodeId: string,
    private readonly cfg: { ttlMs: number; debounceMs: number },
    /** Whether a connection id is still open on this node (detects our own leftover claims). */
    private readonly isLocalAlive: (connectionId: string) => boolean,
    private readonly onError: (err: unknown) => void,
  ) {}

  record(connectionId: string): ControllerRecord {
    return { connectionId, nodeId: this.nodeId };
  }

  async claim(playerId: string, connectionId: string, force: boolean): Promise<ClaimResult> {
    const rec = this.record(connectionId);
    let res = await this.presence.claim(playerId, rec, this.cfg.ttlMs, force);
    // A claim held by a connection of THIS node that no longer exists is a leftover (e.g. a lost release): reclaim it.
    if (!res.claimed && res.previous && res.previous.nodeId === this.nodeId && !this.isLocalAlive(res.previous.connectionId)) {
      res = await this.presence.claim(playerId, rec, this.cfg.ttlMs, true);
    }
    if (res.claimed) this.gained(playerId);
    return res;
  }

  /** False when the claim was lost (taken over). Re-claims a key that expired without anyone taking it. */
  async refresh(playerId: string, connectionId: string): Promise<boolean> {
    const rec = this.record(connectionId);
    if (await this.presence.refresh(playerId, rec, this.cfg.ttlMs)) return true;
    const res = await this.presence.claim(playerId, rec, this.cfg.ttlMs, false);
    return res.claimed;
  }

  /** The controller socket closed: free the key and report the disconnect after the debounce window. */
  async released(playerId: string, connectionId: string): Promise<void> {
    try {
      await this.presence.release(playerId, this.record(connectionId));
    } finally {
      this.scheduleDisconnect(playerId);
    }
  }

  /** Resolves when every pending debounced disconnect has been decided (graceful shutdown). */
  async flush(): Promise<void> {
    await Promise.all([...this.pendingDisconnects.values()].map((p) => p.done));
  }

  private gained(playerId: string): void {
    const pending = this.pendingDisconnects.get(playerId);
    if (pending) {
      // Back within the debounce window: the table never saw a disconnect, so there is nothing to report.
      pending.cancel();
      return;
    }
    if (this.reportedConnected.has(playerId)) return;
    this.reportedConnected.add(playerId);
    this.backend.playerConnection(playerId, true);
  }

  private scheduleDisconnect(playerId: string): void {
    this.pendingDisconnects.get(playerId)?.cancel();
    let settle: () => void = () => undefined;
    let finished = false;
    const finish = (): boolean => {
      if (finished) return false;
      finished = true;
      clearTimeout(entry.timer);
      if (this.pendingDisconnects.get(playerId) === entry) this.pendingDisconnects.delete(playerId);
      return true;
    };
    const entry: PendingDisconnect = {
      timer: undefined,
      done: new Promise<void>((r) => (settle = r)),
      cancel: () => {
        if (finish()) settle();
      },
      run: async () => {
        if (!finish()) return;
        this.reportedConnected.delete(playerId);
        try {
          // Another node (or a newer socket) holds the controller: the player is still connected.
          if (!(await this.presence.get(playerId))) this.backend.playerConnection(playerId, false);
        } catch (err) {
          this.onError(err);
        } finally {
          settle();
        }
      },
    };
    this.pendingDisconnects.set(playerId, entry);
    entry.timer = setTimeout(() => void entry.run(), this.cfg.debounceMs);
    entry.timer.unref?.();
  }
}
