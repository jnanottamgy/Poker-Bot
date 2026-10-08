import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { PlayerTableView, ServerMessage, TournamentConfig, TournamentListItemDto, TournamentPublicSummary } from '@jpb/shared-types';
import { applyPreset, defaultTournamentConfig } from '@jpb/validation';

/**
 * Load generator: real HTTP registrations and one real WebSocket per player,
 * exactly like phones in a venue. Measures what players feel (connect time,
 * time to first snapshot, action round trip) and what the server sustains
 * (frames/s, actions/s), and checks the tournament completes.
 *
 * The target server must allow the registration burst: run it with
 * NODE_ENV=development RATE_LIMIT_SCALE=1000 (rate limits are fixed in production).
 */
export interface LoadOptions {
  base: string;
  admin: { username: string; password: string };
  players: number;
  /** Concurrent connection/registration ramp (default 50). */
  concurrency?: number;
  /** Bot think time range in ms (default 300–1500). */
  thinkMs?: [number, number];
  /** Fast blinds (SPEED_TEST preset; the server must allow speed mode). Default true. */
  speed?: boolean;
  /** Stop after this long even if the tournament is not over (default 30 min). */
  maxDurationMs?: number;
  /** Progress callback (every ~5 s). */
  onProgress?: (p: LoadProgress) => void;
  /** Origin header (defaults to base). */
  origin?: string;
}

export interface LoadProgress {
  elapsedMs: number;
  status: string;
  active: number;
  tables: number;
  hands: number;
  actions: number;
  framesIn: number;
  openSockets: number;
}

export interface Percentiles {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface LoadResult {
  tournamentId: string;
  joinCode: string;
  players: number;
  completed: boolean;
  status: string;
  durationMs: number;
  registrationMs: Percentiles;
  connectMs: Percentiles;
  actionRoundTripMs: Percentiles;
  actions: number;
  actionsRejected: number;
  actionsPerSecond: number;
  framesIn: number;
  framesPerSecond: number;
  /** Frames received per frame type (t), summed over all players. */
  framesByType: Record<string, number>;
  bytesIn: number;
  hands: number;
  disconnects: number;
  errors: string[];
}

export function percentiles(values: number[]): Percentiles {
  if (!values.length) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return { count: s.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), p99: Math.round(at(0.99)), max: Math.round(s[s.length - 1]!) };
}

class Client {
  private readonly cookies = new Map<string, string>();
  constructor(
    readonly base: string,
    readonly origin: string,
  ) {}
  cookie(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { origin: this.origin, cookie: this.cookie() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const csrf = this.cookies.get('jpb_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(`${this.base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const i = pair!.indexOf('=');
      const v = pair!.slice(i + 1).trim();
      if (v) this.cookies.set(pair!.slice(0, i).trim(), v);
    }
    const text = await res.text();
    if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
}

/** Deterministic xorshift for think times (Math.random is banned in this repo). */
function rng(seed: number): () => number {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!, i);
      }
    }),
  );
}

export function loadConfig(players: number, speed: boolean, joinCode: string): TournamentConfig {
  const base = defaultTournamentConfig({ name: `Load test · ${players} players`, joinCode, minPlayers: 2, maxPlayers: Math.max(2, players), speedMode: speed });
  const cfg = applyPreset(base, speed ? 'SPEED_TEST' : 'HYPER');
  const paid = Math.max(1, Math.floor(players * 0.1));
  return {
    ...cfg,
    registration: { ...cfg.registration, requireApproval: false, accessCode: null },
    prizeStructure: { currency: 'INR', places: Array.from({ length: paid }, (_, i) => ({ position: i + 1, amountMinor: Math.max(100, Math.floor(1_000_000 / (i + 1))) })), notes: 'Load test' },
  };
}

export async function runLoad(opts: LoadOptions): Promise<LoadResult> {
  const origin = opts.origin ?? opts.base;
  const concurrency = opts.concurrency ?? 50;
  const [thinkLo, thinkHi] = opts.thinkMs ?? [300, 1500];
  const errors: string[] = [];
  const err = (e: unknown) => {
    if (errors.length < 50) errors.push(String((e as Error)?.message ?? e));
  };
  const admin = new Client(opts.base, origin);
  await admin.req('POST', '/api/admin/auth/login', opts.admin);
  const joinCode = `LOAD${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const { tournament } = await admin.req<{ tournament: TournamentListItemDto }>('POST', '/api/admin/tournaments', { config: loadConfig(opts.players, opts.speed ?? true, joinCode) });
  await admin.req('POST', `/api/admin/tournaments/${tournament.id}/registration/open`, {});

  const clients = Array.from({ length: opts.players }, () => new Client(opts.base, origin));
  const regMs: number[] = [];
  await pool(clients, concurrency, async (c, i) => {
    const t0 = performance.now();
    try {
      await c.req('POST', `/api/public/tournaments/${tournament.joinCode}/register`, { fields: { name: `Load ${i + 1}` }, clientSeed: (i + 1).toString(16).padStart(64, '0') });
      regMs.push(performance.now() - t0);
    } catch (e) {
      err(e);
    }
  });

  const wsUrl = `${opts.base.replace(/^http/, 'ws')}/ws`;
  const connectMs: number[] = [];
  const rtt: number[] = [];
  const pending = new Map<string, number>();
  let actions = 0;
  let rejected = 0;
  let framesIn = 0;
  let bytesIn = 0;
  const framesByType: Record<string, number> = {};
  let disconnects = 0;
  let stopping = false;
  const sockets: WebSocket[] = [];
  const timers = new Set<NodeJS.Timeout>();

  await pool(clients, concurrency, async (c, i) => {
    const rand = rng(i + 1);
    const answered = new Set<string>();
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      let first = true;
      const ws = new WebSocket(wsUrl, { headers: { cookie: c.cookie(), origin } });
      sockets.push(ws);
      const done = () => resolve();
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, audience: 'PLAYER', tournamentId: tournament.id, resume: null })));
      ws.on('error', (e) => {
        err(e);
        done();
      });
      ws.on('close', () => {
        if (!stopping) disconnects++;
        done();
      });
      ws.on('message', (data: Buffer) => {
        framesIn++;
        bytesIn += data.length;
        const m = JSON.parse(String(data)) as ServerMessage;
        framesByType[m.t] = (framesByType[m.t] ?? 0) + 1;
        if (m.t === 'snapshot') {
          if (first) connectMs.push(performance.now() - t0);
          first = false;
          done();
          if (m.snapshot.audience === 'PLAYER') act(m.snapshot.table);
        } else if (m.t === 'table_update') act(m.view as PlayerTableView);
        else if (m.t === 'action_result') {
          const sent = pending.get(m.actionId);
          if (sent !== undefined) {
            rtt.push(performance.now() - sent);
            pending.delete(m.actionId);
          }
          if (!m.ok) rejected++;
        }
      });
      function act(view: PlayerTableView | null) {
        const legal = view?.you?.legal;
        if (!view || !legal || stopping) return;
        const key = `${view.tableId}:${view.hand?.handId}:${view.hand?.turnVersion}`;
        if (answered.has(key)) return;
        answered.add(key);
        const r = rand();
        const intent = legal.canCheck ? { type: 'CHECK' as const } : r < 0.08 && legal.canAllIn ? { type: 'ALL_IN' as const } : r < 0.6 && legal.canCall ? { type: 'CALL' as const } : { type: 'FOLD' as const };
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (stopping || ws.readyState !== WebSocket.OPEN) return;
          const actionId = randomUUID();
          pending.set(actionId, performance.now());
          actions++;
          ws.send(JSON.stringify({ t: 'action', actionId, tableId: view.tableId, type: intent.type, tableStateVersion: view.hand?.turnVersion ?? 0 }));
        }, thinkLo + Math.floor(rand() * Math.max(1, thinkHi - thinkLo)));
        timers.add(timer);
      }
    });
  });

  const started = Date.now();
  await admin.req('POST', `/api/admin/tournaments/${tournament.id}/start`, {});
  let summary: TournamentPublicSummary | null = null;
  const deadline = started + (opts.maxDurationMs ?? 30 * 60_000);
  let lastProgress = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    summary = await admin.req<TournamentPublicSummary>('GET', `/api/public/tournaments/${tournament.joinCode}/summary`).catch((e) => {
      err(e);
      return summary;
    });
    if (opts.onProgress && Date.now() - lastProgress > 5000) {
      lastProgress = Date.now();
      opts.onProgress({
        elapsedMs: Date.now() - started,
        status: summary?.status ?? '?',
        active: summary?.counters.active ?? 0,
        tables: summary?.counters.tables ?? 0,
        hands: summary?.counters.handsCompleted ?? 0,
        actions,
        framesIn,
        openSockets: sockets.filter((s) => s.readyState === WebSocket.OPEN).length,
      });
    }
    if (summary?.status === 'COMPLETED' || summary?.status === 'CANCELLED' || Date.now() > deadline) break;
  }
  stopping = true;
  for (const t of timers) clearTimeout(t);
  for (const s of sockets) s.close();
  const durationMs = Date.now() - started;
  return {
    tournamentId: tournament.id,
    joinCode: tournament.joinCode,
    players: opts.players,
    completed: summary?.status === 'COMPLETED',
    status: summary?.status ?? 'UNKNOWN',
    durationMs,
    registrationMs: percentiles(regMs),
    connectMs: percentiles(connectMs),
    actionRoundTripMs: percentiles(rtt),
    actions,
    actionsRejected: rejected,
    actionsPerSecond: Math.round((actions / Math.max(1, durationMs / 1000)) * 10) / 10,
    framesIn,
    framesPerSecond: Math.round((framesIn / Math.max(1, durationMs / 1000)) * 10) / 10,
    framesByType,
    bytesIn,
    hands: summary?.counters.handsCompleted ?? 0,
    disconnects,
    errors,
  };
}
