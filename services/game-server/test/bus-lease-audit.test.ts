import { afterAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { LocalBus } from '../src/bus/local-bus';
import { RedisBus } from '../src/bus/redis-bus';
import type { MessageBus } from '../src/bus/bus';
import { MemoryLeaseManager, RedisLeaseManager } from '../src/runtime/lease';
import type { LeaseManager } from '../src/runtime/lease';
import { AUDIT_GENESIS_HASH, chainEntry, verifyAuditChain } from '../src/audit/chain';
import type { ChainedAuditEntry } from '../src/audit/chain';
import { canonicalJson } from '../src/util/canonical-json';

const redisUrl = process.env.TEST_REDIS_URL;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function busContract(name: string, make: () => MessageBus) {
  describe(`${name} bus`, () => {
    const bus = make();
    afterAll(() => bus.close());
    it('delivers in publish order and isolates payloads', async () => {
      const got: unknown[] = [];
      const unsub = await bus.subscribe(`test:${name}:a`, (m) => got.push(m));
      const msg = { n: 1, nested: { x: [1, 2] } };
      await bus.publish(`test:${name}:a`, msg);
      for (let i = 2; i <= 50; i++) await bus.publish(`test:${name}:a`, { n: i });
      msg.nested.x.push(3);
      await tick(100);
      expect(got.map((m) => (m as { n: number }).n)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      expect((got[0] as { nested: { x: number[] } }).nested.x).toEqual([1, 2]);
      await unsub();
      await bus.publish(`test:${name}:a`, { n: 99 });
      await tick(50);
      expect(got).toHaveLength(50);
    });
  });
}

busContract('local', () => new LocalBus());
if (redisUrl) busContract('redis', () => new RedisBus(redisUrl));

function leaseContract(name: string, make: () => LeaseManager) {
  describe(`${name} leases`, () => {
    const lm = make();
    it('grants exclusive ownership with increasing epochs', async () => {
      const res = `t-${name}-${Date.now()}`;
      const a = await lm.acquire(res, 'node-a', 1000, 0);
      expect(a).not.toBeNull();
      expect(await lm.acquire(res, 'node-b', 1000, 10)).toBeNull();
      const renewed = await lm.renew(a!, 1000, 20);
      expect(renewed?.epoch).toBe(a!.epoch);
      await lm.release(a!);
      const b = await lm.acquire(res, 'node-b', 1000, 30);
      expect(b?.epoch).toBeGreaterThan(a!.epoch);
      expect(await lm.renew(a!, 1000, 40)).toBeNull();
      await lm.release(b!);
    });
  });
}

leaseContract('memory', () => new MemoryLeaseManager());
if (redisUrl) {
  const redis = new Redis(redisUrl);
  afterAll(() => redis.quit());
  leaseContract('redis', () => new RedisLeaseManager(redis, `jpb:test:${process.pid}:`));
}

describe('memory lease expiry', () => {
  it('lets another node take over after expiry (failover)', async () => {
    const lm = new MemoryLeaseManager();
    const a = await lm.acquire('t1', 'a', 100, 0);
    const b = await lm.acquire('t1', 'b', 100, 150);
    expect(b?.epoch).toBe((a?.epoch ?? 0) + 1);
    expect(await lm.renew(a!, 100, 160)).toBeNull();
  });
});

describe('audit chain', () => {
  const content = (i: number) => ({
    id: `a${i}`,
    at: 1000 + i,
    tournamentId: 't1',
    adminId: 'admin_001',
    adminUsername: 'director',
    action: 'MOVE_PLAYER',
    target: 'player:JPN-8F42',
    reason: 'balance',
    beforeState: { table: 37, seat: 4 },
    afterState: { table: 42, seat: 6 },
    ip: null,
  });
  it('verifies an intact chain and detects tampering', () => {
    const entries: ChainedAuditEntry[] = [];
    let prev = AUDIT_GENESIS_HASH;
    for (let i = 0; i < 5; i++) {
      const e = chainEntry(prev, content(i));
      entries.push(e);
      prev = e.hash;
    }
    expect(verifyAuditChain(entries)).toBe(-1);
    const tampered = entries.map((e) => ({ ...e }));
    tampered[2] = { ...tampered[2]!, afterState: { table: 1, seat: 1 } };
    expect(verifyAuditChain(tampered)).toBe(2);
    expect(verifyAuditChain([entries[0]!, entries[2]!])).toBe(1);
  });
  it('canonical json is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
  });
});
