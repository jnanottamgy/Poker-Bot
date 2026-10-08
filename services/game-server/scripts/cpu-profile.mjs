// Takes a CPU profile of a running Node process via the inspector (kill -USR1 <pid> first).
// Usage: node scripts/cpu-profile.mjs <seconds> <out.cpuprofile> [port]
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const seconds = Number(process.argv[2] ?? 10);
const out = process.argv[3] ?? 'profile.cpuprofile';
const port = Number(process.argv[4] ?? 9229);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
});
const call = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
await call('Profiler.enable');
await call('Profiler.setSamplingInterval', { interval: 500 });
await call('Profiler.start');
await new Promise((r) => setTimeout(r, seconds * 1000));
const res = await call('Profiler.stop');
writeFileSync(out, JSON.stringify(res.result.profile));
ws.close();
console.log('wrote', out);
