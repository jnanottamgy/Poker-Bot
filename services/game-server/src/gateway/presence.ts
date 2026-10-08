import type { Redis } from 'ioredis';

/**
 * Presence store for the one-controller-per-player rule (spec §70). The
 * controller key of a player names the single connection (and the node that
 * holds it) allowed to act. It has a TTL refreshed while the connection is
 * alive, so a crashed node's claims expire on their own.
 *
 * All operations are compare-and-set on the full record, so a node can never
 * refresh or release a claim that another connection has taken over.
 */
export interface ControllerRecord {
  connectionId: string;
  nodeId: string;
}

export interface ClaimResult {
  /** True when `record` is now the controller. */
  claimed: boolean;
  /** The controller before this call (null when there was none or it expired). */
  previous: ControllerRecord | null;
}

export interface PresenceStore {
  /** Claim the controller key. Without `force` it only succeeds when the key is free (or already ours). */
  claim(playerId: string, record: ControllerRecord, ttlMs: number, force: boolean): Promise<ClaimResult>;
  /** Extend our claim. False when the key is no longer ours (expired or taken over). */
  refresh(playerId: string, record: ControllerRecord, ttlMs: number): Promise<boolean>;
  /** Delete our claim; a no-op when someone else holds the key. */
  release(playerId: string, record: ControllerRecord): Promise<void>;
  get(playerId: string): Promise<ControllerRecord | null>;
}

const sameRecord = (a: ControllerRecord, b: ControllerRecord) => a.connectionId === b.connectionId && a.nodeId === b.nodeId;

/** Single-node presence store (also used in tests). */
export class MemoryPresenceStore implements PresenceStore {
  private readonly entries = new Map<string, { record: ControllerRecord; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async claim(playerId: string, record: ControllerRecord, ttlMs: number, force: boolean): Promise<ClaimResult> {
    const previous = this.live(playerId);
    if (previous && !force && !sameRecord(previous, record)) return { claimed: false, previous };
    this.entries.set(playerId, { record: { ...record }, expiresAt: this.now() + ttlMs });
    return { claimed: true, previous };
  }

  async refresh(playerId: string, record: ControllerRecord, ttlMs: number): Promise<boolean> {
    const current = this.live(playerId);
    if (!current || !sameRecord(current, record)) return false;
    this.entries.set(playerId, { record: current, expiresAt: this.now() + ttlMs });
    return true;
  }

  async release(playerId: string, record: ControllerRecord): Promise<void> {
    const current = this.live(playerId);
    if (current && sameRecord(current, record)) this.entries.delete(playerId);
  }

  async get(playerId: string): Promise<ControllerRecord | null> {
    return this.live(playerId);
  }

  private live(playerId: string): ControllerRecord | null {
    const e = this.entries.get(playerId);
    if (!e) return null;
    if (e.expiresAt <= this.now()) {
      this.entries.delete(playerId);
      return null;
    }
    return { ...e.record };
  }
}

const CLAIM_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur and ARGV[3] ~= '1' and cur ~= ARGV[1] then return {0, cur} end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return {1, cur or ''}
`;

const REFRESH_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return 0
`;

const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

const encode = (r: ControllerRecord) => JSON.stringify([r.connectionId, r.nodeId]);

function decode(raw: string | null | undefined): ControllerRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') return { connectionId: v[0], nodeId: v[1] };
  } catch {
    // fall through: unreadable values are treated as absent
  }
  return null;
}

/** Cross-node presence store (Redis SET PX + Lua compare-and-set). */
export class RedisPresenceStore implements PresenceStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'jpb:presence:',
  ) {}

  private key(playerId: string): string {
    return `${this.prefix}ctl:${playerId}`;
  }

  async claim(playerId: string, record: ControllerRecord, ttlMs: number, force: boolean): Promise<ClaimResult> {
    const [ok, prev] = (await this.redis.eval(CLAIM_LUA, 1, this.key(playerId), encode(record), String(ttlMs), force ? '1' : '0')) as [
      number,
      string,
    ];
    return { claimed: ok === 1, previous: decode(prev) };
  }

  async refresh(playerId: string, record: ControllerRecord, ttlMs: number): Promise<boolean> {
    return ((await this.redis.eval(REFRESH_LUA, 1, this.key(playerId), encode(record), String(ttlMs))) as number) === 1;
  }

  async release(playerId: string, record: ControllerRecord): Promise<void> {
    await this.redis.eval(RELEASE_LUA, 1, this.key(playerId), encode(record));
  }

  async get(playerId: string): Promise<ControllerRecord | null> {
    return decode(await this.redis.get(this.key(playerId)));
  }
}
