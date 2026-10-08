import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../services/game-server/src/config/env';
import { buildServer } from '../../services/game-server/src/server';
import { createTestDatabase, TEST_DATABASE_URL } from '../../services/game-server/test/helpers/db';
import { runLoad } from './lib';

/** The load harness itself, at a size CI can afford: 120 real WebSocket players on one in-process node. */
describe.skipIf(!TEST_DATABASE_URL)('load smoke', () => {
  it('120 WebSocket players (raising, going all-in, dropping and reconnecting) complete a tournament with low latency and no errors', async () => {
    const db = await createTestDatabase('load_smoke');
    const env = loadEnv({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      PUBLIC_BASE_URL: 'http://127.0.0.1',
      COOKIE_SECURE: 'false',
      SEED_ENCRYPTION_KEY: 'e'.repeat(64),
      BOOTSTRAP_ADMIN_USERNAME: 'load',
      BOOTSTRAP_ADMIN_PASSWORD: 'load test password 123',
      RATE_LIMIT_SCALE: '1000',
    });
    const server = await buildServer(env, { db, logger: { level: process.env.LOAD_LOG ?? 'silent' } });
    try {
      const base = await server.listen();
      const r = await runLoad({ base, origin: 'http://127.0.0.1', admin: { username: 'load', password: 'load test password 123' }, players: 120, thinkMs: [50, 400], churn: 0.03, maxDurationMs: 240_000 });
      expect(r.errors).toEqual([]);
      expect(r.completed).toBe(true);
      expect(r.connectMs.count).toBe(120);
      expect(r.actions).toBeGreaterThan(120);
      expect(r.actionRoundTripMs.p95).toBeLessThan(1000);
      expect(r.disconnects).toBe(0);
      expect(r.reconnects).toBeGreaterThan(0);
      // Every reconnect resyncs from a snapshot (one may still be in flight when the champion is crowned).
      expect(r.reconnectMs.count).toBeGreaterThanOrEqual(r.reconnects - 1);
    } finally {
      await server.close();
      await db.close();
    }
  }, 300_000);
});
