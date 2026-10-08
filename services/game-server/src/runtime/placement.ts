import type { NodeRole } from '../config/env';
import type { ActorPool } from './actor';

/**
 * Actor placement by weighted rendezvous (highest-random-weight) hashing:
 * every node scores every actor independently and the highest score wins, so
 * all nodes agree on the owner from the same membership view, and a node
 * joining or leaving moves only ~1/n of the actors.
 *
 * Weighted score (Schindelhauer & Schomaker): -capacity / ln(u), with u in
 * (0,1) derived from a hash of (nodeId, actor key). Capacity 2 receives about
 * twice as many actors as capacity 1.
 */
export interface PlacementCandidate {
  nodeId: string;
  role: NodeRole;
  capacity: number;
}

const POOL_ROLES: Record<ActorPool, ReadonlySet<NodeRole>> = {
  worker: new Set<NodeRole>(['worker', 'all']),
  orchestrator: new Set<NodeRole>(['orchestrator', 'all']),
};

export const roleServesPool = (role: NodeRole, pool: ActorPool): boolean => POOL_ROLES[pool].has(role);

/** cyrb53: fast, well-distributed 53-bit string hash (not cryptographic; placement only). */
export function hash53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const TWO_POW_53 = 2 ** 53;

export function rendezvousScore(nodeId: string, key: string, capacity: number): number {
  const u = (hash53(`${nodeId}\u0000${key}`) + 0.5) / TWO_POW_53;
  return -Math.max(capacity, 0) / Math.log(u);
}

/** The node that should own `key` among nodes serving `pool`, or null if none is live. */
export function placeActor(key: string, pool: ActorPool, nodes: readonly PlacementCandidate[]): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const n of nodes) {
    if (!roleServesPool(n.role, pool) || n.capacity <= 0) continue;
    const s = rendezvousScore(n.nodeId, key, n.capacity);
    if (s > bestScore || (s === bestScore && best !== null && n.nodeId < best)) {
      best = n.nodeId;
      bestScore = s;
    }
  }
  return best;
}
