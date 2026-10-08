import { EnvError, loadEnv } from './config/env';
import { buildServer } from './server';

/**
 * Process entry point: `npm start` / the Docker image. Reads the environment,
 * builds the node (migrations, runtime, gateway, API, web apps), listens, and
 * shuts down gracefully on SIGTERM/SIGINT: the gateway tells clients to
 * reconnect, actors hand off with a final snapshot, leases are released.
 */
async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(`\n${err.message}\n\nSee docs/DEPLOYMENT.md (run \`node scripts/setup-env.mjs\` to generate a .env).\n`);
      process.exit(1);
    }
    throw err;
  }
  const server = await buildServer(env);
  const log = server.app.log;
  if (env.seedKeyIsEphemeral) log.warn('SEED_ENCRYPTION_KEY is not set: server seeds of tournaments created now cannot be decrypted after a restart. Set it for anything but a quick local try-out.');
  if (!env.bootstrapAdmin) log.info('No BOOTSTRAP_ADMIN_* set: create the first admin with `npm run admin:create` if none exists yet.');
  const url = await server.listen();
  log.info({ url, node: env.nodeId, role: env.role, publicBaseUrl: env.publicBaseUrl }, "Johnny's Poker Bot is up");

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'shutting down gracefully');
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    try {
      await server.close();
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));
}

void main().catch((err: unknown) => {
  console.error('Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
