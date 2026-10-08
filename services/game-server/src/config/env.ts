import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Process configuration from environment variables. Validated at boot; the
 * server refuses to start in production with unsafe settings.
 */
const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

export const NODE_ROLES = ['all', 'gateway', 'worker', 'orchestrator'] as const;
export type NodeRole = (typeof NODE_ROLES)[number];

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  /** PostgreSQL connection string. Absent => in-memory store (development/test only). */
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(500).default(20),
  /** Redis connection string. Absent => single-node in-process message bus. */
  REDIS_URL: z.string().min(1).optional(),
  NODE_ROLE: z.enum(NODE_ROLES).default('all'),
  NODE_ID: z.string().min(1).optional(),
  /** 32-byte hex key encrypting server seeds at rest (AES-256-GCM). */
  SEED_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: bool.default(false),
  /**
   * Venue LAN mode: allows plain-HTTP cookies in production for an offline
   * local network (players join http://192.168.x.x). Prefer HTTPS via the free
   * Cloudflare tunnel profile whenever internet is available.
   */
  ALLOW_INSECURE_LAN_HTTP: bool.default(false),
  /** Allows accelerated "speed mode" tournaments (1-second levels) — never enable for real events. */
  SPEED_MODE_ALLOWED: bool.optional(),
  /** Allows the simulation / demo tournament endpoints. */
  SIMULATION_ALLOWED: bool.optional(),
  BOOTSTRAP_ADMIN_USERNAME: z.string().min(3).max(64).optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(256).optional(),
  SNAPSHOT_EVERY_COMMANDS: z.coerce.number().int().min(10).max(100_000).default(250),
  STALL_THRESHOLD_SECONDS: z.coerce.number().int().min(5).max(3600).default(45),
  ACTION_LATENCY_ALERT_MS: z.coerce.number().int().min(10).default(500),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(48),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  STATIC_DIR: z.string().optional(),
  /** Multiplies every rate limit (load testing from one IP). Ignored in production. */
  RATE_LIMIT_SCALE: z.coerce.number().min(1).max(100_000).default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface ServerEnv {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  publicBaseUrl: string;
  databaseUrl: string | null;
  databasePoolMax: number;
  redisUrl: string | null;
  role: NodeRole;
  nodeId: string;
  seedEncryptionKey: string;
  seedKeyIsEphemeral: boolean;
  cookieSecure: boolean;
  trustProxy: boolean;
  insecureLanHttp: boolean;
  speedModeAllowed: boolean;
  simulationAllowed: boolean;
  bootstrapAdmin: { username: string; password: string } | null;
  snapshotEveryCommands: number;
  stallThresholdMs: number;
  actionLatencyAlertMs: number;
  sessionTtlMs: number;
  adminSessionTtlMs: number;
  staticDir: string | null;
  rateLimitScale: number;
  logLevel: string;
}

export class EnvError extends Error {}

export function loadEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new EnvError(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';

  if (production) {
    const problems: string[] = [];
    if (!e.DATABASE_URL) problems.push('DATABASE_URL is required in production (crash recovery needs persistence)');
    if (!e.SEED_ENCRYPTION_KEY) problems.push('SEED_ENCRYPTION_KEY is required in production');
    if (e.COOKIE_SECURE === false && !e.ALLOW_INSECURE_LAN_HTTP) {
      problems.push('COOKIE_SECURE=false is not allowed in production (set ALLOW_INSECURE_LAN_HTTP=true only for an offline venue LAN)');
    }
    if (e.NODE_ROLE !== 'all' && !e.REDIS_URL) problems.push(`NODE_ROLE=${e.NODE_ROLE} requires REDIS_URL`);
    if (problems.length) throw new EnvError(`Unsafe production configuration: ${problems.join('; ')}`);
  }
  if (e.NODE_ROLE !== 'all' && !e.REDIS_URL) {
    throw new EnvError(`NODE_ROLE=${e.NODE_ROLE} requires REDIS_URL (multi-node mode)`);
  }
  if ((e.BOOTSTRAP_ADMIN_USERNAME === undefined) !== (e.BOOTSTRAP_ADMIN_PASSWORD === undefined)) {
    throw new EnvError('BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD must be set together');
  }

  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    databaseUrl: e.DATABASE_URL ?? null,
    databasePoolMax: e.DATABASE_POOL_MAX,
    redisUrl: e.REDIS_URL ?? null,
    role: e.NODE_ROLE,
    nodeId: e.NODE_ID ?? `${hostname()}-${randomBytes(3).toString('hex')}`,
    seedEncryptionKey: e.SEED_ENCRYPTION_KEY ?? randomBytes(32).toString('hex'),
    seedKeyIsEphemeral: !e.SEED_ENCRYPTION_KEY,
    cookieSecure: e.COOKIE_SECURE ?? production,
    trustProxy: e.TRUST_PROXY,
    insecureLanHttp: e.ALLOW_INSECURE_LAN_HTTP,
    speedModeAllowed: e.SPEED_MODE_ALLOWED ?? !production,
    simulationAllowed: e.SIMULATION_ALLOWED ?? !production,
    bootstrapAdmin:
      e.BOOTSTRAP_ADMIN_USERNAME && e.BOOTSTRAP_ADMIN_PASSWORD
        ? { username: e.BOOTSTRAP_ADMIN_USERNAME, password: e.BOOTSTRAP_ADMIN_PASSWORD }
        : null,
    snapshotEveryCommands: e.SNAPSHOT_EVERY_COMMANDS,
    stallThresholdMs: e.STALL_THRESHOLD_SECONDS * 1000,
    actionLatencyAlertMs: e.ACTION_LATENCY_ALERT_MS,
    sessionTtlMs: e.SESSION_TTL_HOURS * 3_600_000,
    adminSessionTtlMs: e.ADMIN_SESSION_TTL_HOURS * 3_600_000,
    staticDir: e.STATIC_DIR ?? null,
    rateLimitScale: production ? 1 : e.RATE_LIMIT_SCALE,
    logLevel: e.LOG_LEVEL,
  };
}
