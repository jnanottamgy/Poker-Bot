import type { Redis } from 'ioredis';
import type { NodeRole } from '../config/env';
import type { Clock, ClockTimer } from './clock';
import { systemClock } from './clock';

/**
 * Cluster membership: every node heartbeats an entry {nodeId, role,
 * startedAt, capacity} with a TTL and periodically reads the live set.
 * Placement is computed from this view, so all nodes converge on the same
 * owners once their views agree; leases (not membership) are what guarantee
 * a single owner while views disagree.
 */
export interface MemberInfo {
  nodeId: string;
  role: NodeRole;
  startedAt: number;
  capacity: number;
}

export type MembershipListener = (members: MemberInfo[]) => void;

export interface Membership {
  readonly self: MemberInfo;
  /** Joins (first heartbeat + read) and starts the heartbeat loop. */
  start(): Promise<void>;
  /** Stops heartbeating and leaves the cluster. */
  stop(): Promise<void>;
  /** Stops heartbeating WITHOUT leaving — the entry expires after its TTL (crash simulation). */
  halt(): void;
  /** Last known live members, sorted by nodeId. */
  members(): MemberInfo[];
  /** Heartbeats and re-reads the live set now (notifies listeners on change). */
  refresh(): Promise<MemberInfo[]>;
  onChange(listener: MembershipListener): () => void;
}

export interface MembershipTiming {
  heartbeatMs?: number;
  /** Entry TTL; a node missing ~3 heartbeats is considered dead. */
  ttlMs?: number;
}

const DEFAULT_HEARTBEAT_MS = 2000;
const signature = (ms: MemberInfo[]) => ms.map((m) => `${m.nodeId}/${m.role}/${m.capacity}/${m.startedAt}`).join(',');

abstract class HeartbeatMembership implements Membership {
  protected readonly heartbeatMs: number;
  protected readonly ttlMs: number;
  private view: MemberInfo[] = [];
  private readonly listeners = new Set<MembershipListener>();
  private timer: ClockTimer | null = null;
  private running = false;

  constructor(
    readonly self: MemberInfo,
    protected readonly clock: Clock,
    timing: MembershipTiming,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {
    this.heartbeatMs = timing.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.ttlMs = timing.ttlMs ?? this.heartbeatMs * 3;
  }

  protected abstract heartbeat(): Promise<void>;
  protected abstract list(): Promise<MemberInfo[]>;
  protected abstract leave(): Promise<void>;

  async start(): Promise<void> {
    this.running = true;
    await this.refresh();
    this.schedule();
  }

  async stop(): Promise<void> {
    this.halt();
    await this.leave();
    this.apply(this.view.filter((m) => m.nodeId !== this.self.nodeId));
  }

  halt(): void {
    this.running = false;
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  members(): MemberInfo[] {
    return this.view;
  }

  async refresh(): Promise<MemberInfo[]> {
    if (this.running) await this.heartbeat();
    this.apply(await this.list());
    return this.view;
  }

  onChange(listener: MembershipListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(next: MemberInfo[]): void {
    const sorted = [...next].sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
    const changed = signature(sorted) !== signature(this.view);
    this.view = sorted;
    if (changed) for (const l of [...this.listeners]) l(sorted);
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = this.clock.setTimeout(() => {
      this.refresh()
        .catch((err: unknown) => this.onError(err))
        .finally(() => this.schedule());
    }, this.heartbeatMs);
  }
}

/** Shared registry for in-process clusters (single node, or several nodes in one test process). */
export class MemoryMembershipRegistry {
  readonly entries = new Map<string, { info: MemberInfo; expiresAt: number }>();
}

export class MemoryMembership extends HeartbeatMembership {
  constructor(
    self: MemberInfo,
    private readonly registry = new MemoryMembershipRegistry(),
    clock: Clock = systemClock,
    timing: MembershipTiming = {},
  ) {
    super(self, clock, timing);
  }

  protected async heartbeat(): Promise<void> {
    this.registry.entries.set(this.self.nodeId, { info: this.self, expiresAt: this.clock.now() + this.ttlMs });
  }

  protected async list(): Promise<MemberInfo[]> {
    const now = this.clock.now();
    const live: MemberInfo[] = [];
    for (const [id, e] of this.registry.entries) {
      if (e.expiresAt > now) live.push(e.info);
      else this.registry.entries.delete(id);
    }
    return live;
  }

  protected async leave(): Promise<void> {
    this.registry.entries.delete(this.self.nodeId);
  }
}

// Entries are "<expiresAtMs>|<json>" with expiry computed from Redis server
// TIME, so node clock skew never shortens or extends a TTL. (Per-field hash
// TTLs need Redis 7.4; this works on any Redis with Lua.)
const HEARTBEAT_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('HSET', KEYS[1], ARGV[1], tostring(now + tonumber(ARGV[3])) .. '|' .. ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) * 20)
return now
`;

const LIST_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local all = redis.call('HGETALL', KEYS[1])
local live = {}
for i = 1, #all, 2 do
  local v = all[i + 1]
  local sep = string.find(v, '|', 1, true)
  local exp = sep and tonumber(string.sub(v, 1, sep - 1)) or 0
  if exp > now then
    table.insert(live, string.sub(v, sep + 1))
  else
    redis.call('HDEL', KEYS[1], all[i])
  end
end
return live
`;

export class RedisMembership extends HeartbeatMembership {
  private readonly key: string;

  constructor(
    self: MemberInfo,
    private readonly redis: Redis,
    opts: MembershipTiming & { prefix?: string; clock?: Clock; onError?: (err: unknown) => void } = {},
  ) {
    super(self, opts.clock ?? systemClock, opts, opts.onError);
    this.key = `${opts.prefix ?? 'jpb:'}members`;
  }

  protected async heartbeat(): Promise<void> {
    await this.redis.eval(HEARTBEAT_LUA, 1, this.key, this.self.nodeId, JSON.stringify(this.self), String(this.ttlMs));
  }

  protected async list(): Promise<MemberInfo[]> {
    const raw = (await this.redis.eval(LIST_LUA, 1, this.key)) as string[];
    const out: MemberInfo[] = [];
    for (const r of raw) {
      try {
        out.push(JSON.parse(r) as MemberInfo);
      } catch {
        // Ignore malformed entries; they expire on their own.
      }
    }
    return out;
  }

  protected async leave(): Promise<void> {
    await this.redis.hdel(this.key, this.self.nodeId);
  }
}
