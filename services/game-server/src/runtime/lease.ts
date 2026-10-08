import type { Redis } from 'ioredis';

/**
 * Ownership leases: exactly one node runs a given table actor or tournament
 * director at a time (spec §30/§31). A lease has an owner token and an epoch
 * that identifies the lease generation and increases with every new owner.
 * Losing a lease means the node must stop processing that actor immediately.
 *
 * The epoch is NOT the fencing mechanism: the command log's gap-free
 * (resource, seq) primary key is. With Redis the epoch stays increasing even
 * after Redis loses its data: a new epoch is never below the Redis server
 * time in µs (< 2^53 until the year 2255), and one acquisition takes longer
 * than 1 µs — assuming the Redis server clock does not step backwards.
 */
export interface Lease {
  resource: string;
  owner: string;
  epoch: number;
  expiresAt: number;
}

export interface LeaseManager {
  acquire(resource: string, owner: string, ttlMs: number, now: number): Promise<Lease | null>;
  renew(lease: Lease, ttlMs: number, now: number): Promise<Lease | null>;
  release(lease: Lease): Promise<void>;
}

/** Single-node lease manager (also used in tests). */
export class MemoryLeaseManager implements LeaseManager {
  private readonly leases = new Map<string, Lease>();
  private readonly epochs = new Map<string, number>();

  async acquire(resource: string, owner: string, ttlMs: number, now: number): Promise<Lease | null> {
    const current = this.leases.get(resource);
    if (current && current.expiresAt > now && current.owner !== owner) return null;
    if (current && current.owner === owner && current.expiresAt > now) {
      const renewed = { ...current, expiresAt: now + ttlMs };
      this.leases.set(resource, renewed);
      return renewed;
    }
    const epoch = (this.epochs.get(resource) ?? 0) + 1;
    this.epochs.set(resource, epoch);
    const lease = { resource, owner, epoch, expiresAt: now + ttlMs };
    this.leases.set(resource, lease);
    return lease;
  }

  async renew(lease: Lease, ttlMs: number, now: number): Promise<Lease | null> {
    const current = this.leases.get(lease.resource);
    if (!current || current.owner !== lease.owner || current.epoch !== lease.epoch || current.expiresAt <= now) return null;
    const renewed = { ...current, expiresAt: now + ttlMs };
    this.leases.set(lease.resource, renewed);
    return renewed;
  }

  async release(lease: Lease): Promise<void> {
    const current = this.leases.get(lease.resource);
    if (current && current.owner === lease.owner && current.epoch === lease.epoch) this.leases.delete(lease.resource);
  }
}

const ACQUIRE_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local owner = string.match(cur, '^([^|]*)|')
  if owner ~= ARGV[1] then return nil end
  local epoch = string.match(cur, '|(%d+)$')
  redis.call('SET', KEYS[1], ARGV[1] .. '|' .. epoch, 'PX', ARGV[2])
  return tonumber(epoch)
end
local t = redis.call('TIME')
local floor = tonumber(t[1]) * 1000000 + tonumber(t[2])
local last = tonumber(redis.call('GET', KEYS[2]) or '0')
local epoch = string.format('%d', math.max(last + 1, floor))
redis.call('SET', KEYS[2], epoch)
redis.call('SET', KEYS[1], ARGV[1] .. '|' .. epoch, 'PX', ARGV[2])
return tonumber(epoch)
`;

const RENEW_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

const RELEASE_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

/** Redis-backed leases (SET PX + Lua compare-and-set). */
export class RedisLeaseManager implements LeaseManager {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'jpb:lease:',
  ) {}

  async acquire(resource: string, owner: string, ttlMs: number, now: number): Promise<Lease | null> {
    const epoch = (await this.redis.eval(ACQUIRE_LUA, 2, this.prefix + resource, this.prefix + resource + ':epoch', owner, String(ttlMs))) as
      | number
      | null;
    if (epoch === null) return null;
    return { resource, owner, epoch, expiresAt: now + ttlMs };
  }

  async renew(lease: Lease, ttlMs: number, now: number): Promise<Lease | null> {
    const ok = (await this.redis.eval(RENEW_LUA, 1, this.prefix + lease.resource, `${lease.owner}|${lease.epoch}`, String(ttlMs))) as number;
    return ok === 1 ? { ...lease, expiresAt: now + ttlMs } : null;
  }

  async release(lease: Lease): Promise<void> {
    await this.redis.eval(RELEASE_LUA, 1, this.prefix + lease.resource, `${lease.owner}|${lease.epoch}`);
  }
}
