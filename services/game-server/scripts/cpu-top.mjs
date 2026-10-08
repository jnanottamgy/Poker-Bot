// Summarises a .cpuprofile: top functions by self time and by inclusive time.
import { readFileSync } from 'node:fs';
const p = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const n = Number(process.argv[3] ?? 30);
const byId = new Map(p.nodes.map((x) => [x.id, x]));
const self = new Map();
const counts = new Map();
for (const s of p.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
const total = p.samples.length;
const key = (x) => `${x.callFrame.functionName || '(anon)'} ${x.callFrame.url.split('/').slice(-3).join('/')}:${x.callFrame.lineNumber + 1}`;
for (const [id, c] of counts) { const k = key(byId.get(id)); self.set(k, (self.get(k) ?? 0) + c); }
const parent = new Map();
for (const x of p.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
const incl = new Map();
for (const [id, c] of counts) {
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) { const k = key(byId.get(cur)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) ?? 0) + c); }
}
const pct = (v) => ((100 * v) / total).toFixed(1).padStart(5) + '%';
console.log('SELF');
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, n)) console.log(pct(v), k);
console.log('INCLUSIVE');
for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, n)) console.log(pct(v), k);
