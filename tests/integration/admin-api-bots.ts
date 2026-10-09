import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ActionType, ClientMessage, LegalActions, PlayerTableView, ServerMessage } from '@jpb/shared-types';
import type { Http } from '../../services/game-server/test/helpers/client';

/** Never bets or raises: checks, else calls. Nobody busts unless forced all-in, so the test controls the pace. */
export function passiveAction(legal: LegalActions): ActionType {
  if (legal.canCheck) return 'CHECK';
  if (legal.canCall) return 'CALL';
  if (legal.canAllIn) return 'ALL_IN';
  return 'FOLD';
}

/**
 * A scripted player on a real WebSocket (hello → snapshot → table updates),
 * answering every decision addressed to it with `passiveAction`.
 */
export class PassiveBot {
  private ws: WebSocket | null = null;
  private readonly answered = new Set<string>();
  actions = 0;

  constructor(
    readonly http: Http,
    readonly wsUrl: string,
    readonly tournamentId: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl, { headers: { cookie: this.http.jar.header(), origin: this.http.origin } });
      this.ws = ws;
      ws.on('open', () => this.send({ t: 'hello', v: 1, audience: 'PLAYER', tournamentId: this.tournamentId, resume: null }));
      ws.on('message', (data) => {
        const m = JSON.parse(String(data)) as ServerMessage;
        if (m.t === 'snapshot') {
          resolve();
          if (m.snapshot.audience === 'PLAYER') this.onView(m.snapshot.table);
        } else if (m.t === 'table_update') this.onView(m.view as PlayerTableView);
        else if (m.t === 'error') reject(new Error(`${m.code}: ${m.message}`));
      });
      ws.on('close', () => reject(new Error('socket closed before the snapshot')));
      ws.on('error', reject);
    });
  }

  close(): void {
    this.ws?.close();
  }

  private send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private onView(view: PlayerTableView | null): void {
    if (!view || view.audience !== 'PLAYER' || !view.you?.legal) return;
    const key = `${view.tableId}:${view.hand?.handId}:${view.hand?.turnVersion}`;
    if (this.answered.has(key)) return;
    this.answered.add(key);
    this.actions++;
    this.send({ t: 'action', actionId: randomUUID(), tableId: view.tableId, type: passiveAction(view.you.legal), tableStateVersion: view.hand?.turnVersion ?? 0 });
  }
}
