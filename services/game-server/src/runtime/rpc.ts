import type { WireError } from './errors';

/**
 * Cross-node command routing over the message bus (request/reply on pub/sub).
 *
 *   requester ── RpcRequest ──▶ actor command channel (only the lease holder subscribes)
 *   owner     ── RpcAck     ──▶ node:{requester}:replies   (immediately on receipt)
 *   owner     ── RpcResult  ──▶ node:{requester}:replies   (after the command committed or was rejected)
 *
 * Pub/sub drops messages published while nobody is subscribed (e.g. during a
 * hand-off), so the requester re-publishes the SAME correlationId until it
 * sees an ack; the owner de-duplicates by correlationId, so a retransmission
 * is never processed twice by one owner.
 */
export interface RpcRequest {
  t: 'actor_rpc';
  correlationId: string;
  replyTo: string;
  kind: string;
  actorId: string;
  command: unknown;
}

export type RpcReply =
  | { t: 'actor_ack'; correlationId: string }
  | { t: 'actor_result'; correlationId: string; ok: true; reply: unknown }
  | { t: 'actor_result'; correlationId: string; ok: false; error: WireError };

export const replyChannel = (nodeId: string): string => `node:${nodeId}:replies`;

/** Graceful lease releases are announced so waiting nodes acquire immediately instead of polling. */
export const LEASE_RELEASED_CHANNEL = 'runtime:lease-released';

/** Join/leave announcements so peers refresh membership without waiting for the next heartbeat. */
export const MEMBERSHIP_CHANNEL = 'runtime:membership';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function isRpcRequest(v: unknown): v is RpcRequest {
  return (
    isObj(v) &&
    v.t === 'actor_rpc' &&
    typeof v.correlationId === 'string' &&
    typeof v.replyTo === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.actorId === 'string' &&
    'command' in v
  );
}

export function isRpcReply(v: unknown): v is RpcReply {
  return isObj(v) && (v.t === 'actor_ack' || v.t === 'actor_result') && typeof v.correlationId === 'string';
}

/** Bounded insertion-ordered set (oldest evicted first). */
export class RecentSet {
  private readonly items = new Set<string>();
  constructor(private readonly capacity: number) {}

  /** Adds `id`; returns false if it was already present. */
  add(id: string): boolean {
    if (this.items.has(id)) return false;
    this.items.add(id);
    if (this.items.size > this.capacity) {
      const oldest = this.items.values().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
    return true;
  }
}
