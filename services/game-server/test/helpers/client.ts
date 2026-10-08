import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ClientMessage, PlayerTableView, ServerMessage, TournamentPublicSummary } from '@jpb/shared-types';
import { chooseAction } from './game';

/** Minimal cookie jar for fetch: keeps the latest value of every cookie set by the server. */
export class Jar {
  private readonly cookies = new Map<string, string>();
  absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (value === '' || /max-age=0/i.test(raw) || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

/** HTTP client bound to a base URL with cookies + CSRF header (what the browser apps do). */
export class Http {
  readonly jar = new Jar();
  constructor(
    readonly base: string,
    readonly origin: string,
  ) {}

  async req<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T; text: string; headers: Headers }> {
    const headers: Record<string, string> = { origin: this.origin, cookie: this.jar.header() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const csrf = this.jar.get('jpb_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(`${this.base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    this.jar.absorb(res);
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* CSV / SVG / HTML */
    }
    return { status: res.status, body: parsed as T, text, headers: res.headers };
  }

  async ok<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.req<T>(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${r.text.slice(0, 400)}`);
    return r.body;
  }
}

/**
 * A scripted player on a real WebSocket: renders nothing, but follows the
 * protocol like the player app (hello → snapshot → table updates) and answers
 * every decision addressed to it.
 */
export class WsBot {
  ws: WebSocket | null = null;
  view: PlayerTableView | null = null;
  summary: TournamentPublicSummary | null = null;
  readonly frames: ServerMessage[] = [];
  actions = 0;
  rejected = 0;
  closedWith: number | null = null;
  private answered = new Set<string>();
  private n = 0;

  constructor(
    readonly name: string,
    readonly http: Http,
    readonly wsUrl: string,
    readonly tournamentId: string,
    readonly opts: { act?: boolean; keepFrames?: boolean } = {},
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl, { headers: { cookie: this.http.jar.header(), origin: this.http.origin } });
      this.ws = ws;
      ws.on('open', () => {
        this.send({ t: 'hello', v: 1, audience: 'PLAYER', tournamentId: this.tournamentId, resume: null });
      });
      ws.on('message', (data) => {
        const m = JSON.parse(String(data)) as ServerMessage;
        if (this.opts.keepFrames) this.frames.push(m);
        if (m.t === 'snapshot') {
          resolve();
          if (m.snapshot.audience === 'PLAYER') {
            this.summary = m.snapshot.tournament;
            this.onView(m.snapshot.table);
          }
        } else if (m.t === 'table_update') this.onView(m.view as PlayerTableView);
        else if (m.t === 'tournament_event') this.summary = m.summary ?? this.summary;
        else if (m.t === 'action_result' && !m.ok) this.rejected++;
        else if (m.t === 'error') reject(new Error(`${this.name}: ${m.code} ${m.message}`));
      });
      ws.on('close', (code) => {
        this.closedWith = code;
        reject(new Error(`${this.name}: closed ${code}`));
      });
      ws.on('error', reject);
    });
  }

  send(m: ClientMessage): void {
    this.ws?.send(JSON.stringify(m));
  }

  close(): void {
    this.ws?.close();
  }

  private onView(view: PlayerTableView | null): void {
    if (!view || view.audience !== 'PLAYER') return;
    this.view = view;
    const legal = view.you?.legal;
    if (!legal || this.opts.act === false) return;
    const key = `${view.tableId}:${view.hand?.handId}:${view.hand?.turnVersion}`;
    if (this.answered.has(key)) return;
    this.answered.add(key);
    const intent = chooseAction(legal, ++this.n + view.version);
    this.actions++;
    this.send({ t: 'action', actionId: randomUUID(), tableId: view.tableId, type: intent.type, ...(intent.amount !== undefined ? { amount: intent.amount } : {}), tableStateVersion: view.hand?.turnVersion ?? 0 });
  }
}
