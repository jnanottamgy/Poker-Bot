import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { PlayerTableView, ServerMessage, TournamentListItemDto } from '@jpb/shared-types';
import { loadEnv } from '../../services/game-server/src/config/env';
import type { ServerEnv } from '../../services/game-server/src/config/env';
import { Http } from '../../services/game-server/test/helpers/client';
import { chooseAction, fastConfig } from '../../services/game-server/test/helpers/game';

export const ORIGIN = 'http://127.0.0.1';
export const ADMIN = { username: 'chaos-admin', password: 'chaos admin password 123' };

export function chaosEnv(nodeId: string, extra: Record<string, string> = {}): ServerEnv {
  return loadEnv({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    PUBLIC_BASE_URL: ORIGIN,
    COOKIE_SECURE: 'false',
    SEED_ENCRYPTION_KEY: 'd'.repeat(64),
    BOOTSTRAP_ADMIN_USERNAME: ADMIN.username,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password,
    RATE_LIMIT_SCALE: '100',
    NODE_ID: nodeId,
    ...extra,
  });
}

export async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs: number, everyMs = 100, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`${what} not reached within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Admin login + tournament creation + registration open + N players registered through the public API (spread over the given bases). */
export async function setupTournament(bases: string[], players: number, joinCode: string): Promise<{ admin: Http; tournament: TournamentListItemDto; https: Http[] }> {
  const admin = new Http(bases[0]!, ORIGIN);
  const login = await admin.req('POST', '/api/admin/auth/login', ADMIN);
  if (login.status !== 200) throw new Error(`login failed: ${login.text}`);
  const { tournament } = await admin.ok<{ tournament: TournamentListItemDto }>('POST', '/api/admin/tournaments', { config: fastConfig(players, { joinCode, name: `Chaos ${joinCode}` }) });
  await admin.ok('POST', `/api/admin/tournaments/${tournament.id}/registration/open`, {});
  const https: Http[] = [];
  for (let i = 0; i < players; i++) {
    const http = new Http(bases[i % bases.length]!, ORIGIN);
    await http.ok('POST', `/api/public/tournaments/${tournament.joinCode}/register`, { fields: { name: `Chaos ${i + 1}` } });
    https.push(http);
  }
  return { admin, tournament, https };
}

/**
 * WebSocket player that survives node deaths: when its socket drops it
 * reconnects (to the next live node) and continues from the snapshot.
 */
export class ResilientBot {
  ws: WebSocket | null = null;
  actions = 0;
  reconnects = 0;
  stopped = false;
  private answered = new Set<string>();
  private n = 0;

  constructor(
    readonly http: Http,
    readonly tournamentId: string,
    /** Returns the WebSocket URL to (re)connect to. */
    readonly target: () => string,
    /** 'passive' mostly checks and calls so tournaments last long enough to survive several failures. */
    readonly style: 'aggressive' | 'passive' = 'passive',
  ) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      const open = () => {
        if (this.stopped) return;
        const ws = new WebSocket(this.target(), { headers: { cookie: this.http.jar.header(), origin: ORIGIN } });
        this.ws = ws;
        ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, audience: 'PLAYER', tournamentId: this.tournamentId, resume: null })));
        ws.on('message', (data) => {
          const m = JSON.parse(String(data)) as ServerMessage;
          if (m.t === 'snapshot') {
            resolve();
            if (m.snapshot.audience === 'PLAYER') this.onView(m.snapshot.table);
          } else if (m.t === 'table_update') this.onView(m.view as PlayerTableView);
        });
        ws.on('error', () => undefined);
        ws.on('close', () => {
          if (this.stopped) return;
          this.reconnects++;
          setTimeout(open, 150);
        });
      };
      open();
    });
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private onView(view: PlayerTableView | null): void {
    if (!view || view.audience !== 'PLAYER' || !view.you?.legal) return;
    const key = `${view.tableId}:${view.hand?.handId}:${view.hand?.turnVersion}`;
    if (this.answered.has(key)) return;
    this.answered.add(key);
    const legal = view.you.legal;
    const salt = ++this.n + view.version;
    const intent =
      this.style === 'aggressive' || salt % 13 === 0
        ? chooseAction(legal, salt)
        : legal.canCheck
          ? { type: 'CHECK' as const }
          : legal.canCall && (legal.callAmount <= legal.stack / 4 || salt % 3 === 0)
            ? { type: 'CALL' as const }
            : { type: 'FOLD' as const };
    this.actions++;
    const amount = 'amount' in intent ? intent.amount : undefined;
    this.ws?.send(JSON.stringify({ t: 'action', actionId: randomUUID(), tableId: view.tableId, type: intent.type, ...(amount !== undefined ? { amount } : {}), tableStateVersion: view.hand?.turnVersion ?? 0 }));
  }
}

export const wsUrlOf = (base: string) => `${base.replace(/^http/, 'ws')}/ws`;
