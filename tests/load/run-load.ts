// Load test CLI. Example (server started with NODE_ENV=development RATE_LIMIT_SCALE=1000):
//   npm run load --workspace @jpb/tests -- --base http://localhost:8080 --players 1000 --admin admin:secret
// Options: --players N  --concurrency N  --think 300-1500  --no-speed  --max-minutes 30  --json
import { runLoad } from './lib';

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name: string) => args.includes(`--${name}`);

const base = (arg('base', process.env.LOAD_BASE ?? 'http://localhost:8080') ?? '').replace(/\/+$/, '');
const [username, ...rest] = (arg('admin', process.env.LOAD_ADMIN ?? 'admin:') ?? '').split(':');
const password = rest.join(':');
if (!username || !password) {
  console.error('Usage: run-load --base <url> --admin <user:password> [--players N]');
  process.exit(2);
}
const think = (arg('think', '300-1500') ?? '').split('-').map(Number) as [number, number];

const result = await runLoad({
  base,
  admin: { username, password },
  players: Number(arg('players', '200')),
  concurrency: Number(arg('concurrency', '50')),
  thinkMs: think,
  speed: !flag('no-speed'),
  maxDurationMs: Number(arg('max-minutes', '30')) * 60_000,
  onProgress: (p) =>
    console.log(
      `[${Math.round(p.elapsedMs / 1000)}s] ${p.status} players=${p.active} tables=${p.tables} hands=${p.hands} actions=${p.actions} frames=${p.framesIn} sockets=${p.openSockets}`,
    ),
});

if (flag('json')) console.log(JSON.stringify(result, null, 2));
else {
  const pc = (p: { p50: number; p95: number; p99: number; max: number; count: number }) => `p50 ${p.p50} ms · p95 ${p.p95} ms · p99 ${p.p99} ms · max ${p.max} ms (n=${p.count})`;
  console.log(`\nTournament ${result.joinCode}: ${result.status} after ${Math.round(result.durationMs / 1000)} s, ${result.hands} hands`);
  console.log(`Registration     ${pc(result.registrationMs)}`);
  console.log(`Connect→snapshot ${pc(result.connectMs)}`);
  console.log(`Action RTT       ${pc(result.actionRoundTripMs)}`);
  console.log(`Actions ${result.actions} (${result.actionsPerSecond}/s, ${result.actionsRejected} rejected) · frames ${result.framesIn} (${result.framesPerSecond}/s, ${Math.round(result.bytesIn / 1024)} KiB) · disconnects ${result.disconnects}`);
  if (result.errors.length) console.log(`Errors (${result.errors.length}):\n  ${result.errors.join('\n  ')}`);
}
process.exit(result.completed && result.errors.length === 0 ? 0 : 1);
