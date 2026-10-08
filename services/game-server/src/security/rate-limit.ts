/**
 * Token-bucket rate limiter (in-memory, per node). Deterministic given the
 * `now` values passed in, which keeps it unit-testable. For multi-node
 * deployments the gateway pins each connection to one node, so per-node
 * buckets bound per-connection abuse; HTTP endpoints additionally use the
 * shared Redis-backed limiter.
 */
export interface RateLimitRule {
  /** Maximum burst. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly rule: RateLimitRule,
    private readonly maxKeys = 100_000,
  ) {
    if (rule.capacity <= 0 || rule.refillPerSecond < 0) throw new Error('Invalid rate limit rule');
  }

  /** Returns true when the request is allowed (and consumes `cost` tokens). */
  take(key: string, now: number, cost = 1): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.evictOldest();
      bucket = { tokens: this.rule.capacity, updatedAt: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(this.rule.capacity, bucket.tokens + elapsed * this.rule.refillPerSecond);
      bucket.updatedAt = now;
      // Refresh insertion order so eviction removes the least recently used key.
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
    }
    if (bucket.tokens < cost) return false;
    bucket.tokens -= cost;
    return true;
  }

  /** Seconds until `cost` tokens are available (for Retry-After headers). */
  retryAfterSeconds(key: string, now: number, cost = 1): number {
    const bucket = this.buckets.get(key);
    if (!bucket || this.rule.refillPerSecond === 0) return bucket ? Infinity : 0;
    const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
    const tokens = Math.min(this.rule.capacity, bucket.tokens + elapsed * this.rule.refillPerSecond);
    return tokens >= cost ? 0 : Math.ceil((cost - tokens) / this.rule.refillPerSecond);
  }

  get size(): number {
    return this.buckets.size;
  }

  private evictOldest(): void {
    const oldest = this.buckets.keys().next();
    if (!oldest.done) this.buckets.delete(oldest.value);
  }
}

/** Named limits (spec §74). Tuned for humans on phones; bots in simulation bypass the gateway. */
export const RATE_LIMITS = {
  registration: { capacity: 5, refillPerSecond: 5 / 60 },
  login: { capacity: 5, refillPerSecond: 1 / 30 },
  playerAction: { capacity: 4, refillPerSecond: 2 },
  wsMessage: { capacity: 30, refillPerSecond: 10 },
  adminRead: { capacity: 120, refillPerSecond: 20 },
  adminWrite: { capacity: 20, refillPerSecond: 2 },
  publicRead: { capacity: 60, refillPerSecond: 10 },
} as const satisfies Record<string, RateLimitRule>;
