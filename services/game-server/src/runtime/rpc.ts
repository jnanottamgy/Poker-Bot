import type { WireError } from './errors';

/**
 * Cross-node command routing over the message bus (request/reply on pub/sub).
 *
 *   requester ── RpcRequest ──▶ actor command channel (only the lease holder subscribes)
 *   owner     ── RpcAck     ──▶ node:{requester}:replies   (immediately on receipt)
 *   owner     ── RpcResult  ──▶ node:{requester}:replies   (after the command committed or was rejected)
 *   requester ── RpcRequest ──▶ node:{placed owner}:inbox   (only on retransmission: activate on demand)
 *
 * Pub/sub drops messages published while nobody is subscribed (e.g. during a
 * hand-off), so the requester re-publishes the SAME correlationId (with an
 * increasing `attempt`) until it sees an ack. Exactly-once across owners:
 *   - the owner logs the command with commandId = correlationId;
 *   - an owner keeps the final reply per correlationId and re-sends it when a
 *     retransmission arrives (the ack and the result were both lost);
 *   - an owner whose FIRST copy of a request is a retransmission looks the
 *     correlationId up in the durable log (a previous owner may have committed
 *     it before a hand-off) and answers with the recorded command's reply.
 */
export interface RpcRequest {
  t: 'actor_rpc';
  correlationId: string;
  replyTo: string;
  kind: string;
  actorId: string;
  command: unknown;
  /** 0 (or absent) for the first transmission, then 1, 2, ... for retransmissions. */
  attempt?: number;
  /** A read-only query answered from committed state (never logged, never queued). */
  read?: boolean;
}

export type RpcReply =
  | { t: 'actor_ack'; correlationId: string }
  | { t: 'actor_result'; correlationId: string; ok: true; reply: unknown }
  | { t: 'actor_result'; correlationId: string; ok: false; error: WireError };

export const replyChannel = (nodeId: string): string => `node:${nodeId}:replies`;

/**
 * Per-node inbox. A request that stays unacknowledged (the actor is not
 * active anywhere) is also sent to the placement owner's inbox, which
 * activates the actor on demand and then handles the request as if it had
 * arrived on the actor channel (same correlationId de-duplication).
 */
export const inboxChannel = (nodeId: string): string => `node:${nodeId}:inbox`;

/** Graceful lease releases are announced so waiting nodes acquire immediately instead of polling. */
export const LEASE_RELEASED_CHANNEL = 'runtime:lease-released';

/** Join/leave announcements so peers refresh membership without waiting for the next heartbeat. */
export const MEMBERSHIP_CHANNEL = 'runtime:membership';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export const attemptOf = (req: RpcRequest): number => (typeof req.attempt === 'number' ? req.attempt : 0);

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

/** Bounded insertion-ordered map (oldest entry evicted first). */
export class RecentMap<V> {
  private readonly items = new Map<string, V>();
  constructor(private readonly capacity: number) {}

  get(id: string): V | undefined {
    return this.items.get(id);
  }

  set(id: string, value: V): void {
    this.items.set(id, value);
    if (this.items.size > this.capacity) {
      const oldest = this.items.keys().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
  }
}
