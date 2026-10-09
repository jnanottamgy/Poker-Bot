import { describe, expect, it } from 'vitest';
import type { SocketLike, Scheduler } from '@jpb/client-sdk';
import type { ClientMessage, SpectatorTableView } from '@jpb/shared-types';
import { createDemoEngine } from '../src/demo/demo';
import { DemoRandom, seedFrom } from '../src/demo/prng';
import { INITIAL_DISPLAY_STATE, displayReducer } from '../src/model/reducer';
import type { DisplayAction, DisplayState } from '../src/model/types';
import { createLiveSource } from '../src/net/live';

describe('demo generator', () => {
  it('is deterministic: same seed and clock -> the same frames', () => {
    const frames = (seed: number) => {
      const e = createDemoEngine('running', seed, 1_000_000);
      const out: DisplayAction[] = [...e.open(1_000_000)];
      for (let i = 1; i <= 120; i++) out.push(...e.step(1_000_000 + i * 1_300));
      return JSON.stringify(out);
    };
    expect(frames(7)).toBe(frames(7));
    expect(frames(7)).not.toBe(frames(8));
    expect(new DemoRandom(seedFrom('johnny')).next()).toBe(new DemoRandom(seedFrom('johnny')).next());
  });

  it('drives the reducer through full hands with showdowns, conserving chips', () => {
    const e = createDemoEngine('final', 3, 1_000_000);
    let s: DisplayState = displayReducer(INITIAL_DISPLAY_STATE, { type: 'connection', status: 'open' });
    for (const a of e.open(1_000_000)) s = displayReducer(s, a);
    let showdowns = 0;
    let lastHand = -1;
    for (let i = 1; i <= 600; i++) {
      for (const a of e.step(1_000_000 + i * 1_300)) s = displayReducer(s, a);
      const sd = s.showdown;
      if (sd && sd.description && sd.handNumber !== lastHand) {
        showdowns += 1;
        lastHand = sd.handNumber;
      }
      const v = s.featured as SpectatorTableView;
      const seated = v.seats.reduce((n, x) => n + (x ? x.stack + x.streetContribution : 0), 0);
      const pots = v.hand ? v.hand.pots.reduce((n, p) => n + p.amount, 0) : 0;
      expect(seated + pots).toBe(s.tournament!.counters.totalChips);
    }
    expect(showdowns).toBeGreaterThan(3);
    expect(s.finalTableId).toBe(s.featured!.tableId);
  });

  it('serves leaderboards consistent with the field', () => {
    const e = createDemoEngine('champion', 1, 0);
    const finish = e.leaderboard('finish', 5);
    expect(finish.rows.map((r) => r.finishPosition)).toEqual([1, 2, 3, 4, 5]);
    expect(finish.rows[0]!.prizeMinor).toBeGreaterThan(finish.rows[1]!.prizeMinor);
    const stack = createDemoEngine('running', 1, 0).leaderboard('stack', 10);
    expect(stack.rows).toHaveLength(10);
    expect(stack.rows.every((r, i) => i === 0 || r.stack <= stack.rows[i - 1]!.stack)).toBe(true);
  });
});

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: ClientMessage[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function fakeScheduler(): Scheduler & { timers: Array<{ fn: () => void; ms: number }> } {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  return {
    timers,
    now: () => 1_000,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
  };
}

describe('live source', () => {
  it('says hello as DISPLAY without a resume cursor and forwards raw frames, including display_scene', () => {
    const sockets: FakeSocket[] = [];
    const scheduler = fakeScheduler();
    const src = createLiveSource({ tournamentId: 'trn_1', url: 'ws://x/ws', scheduler, socketFactory: () => sockets[sockets.push(new FakeSocket()) - 1]! });
    const actions: DisplayAction[] = [];
    src.start((a) => actions.push(a));
    sockets[0]!.open();
    expect(sockets[0]!.sent[0]).toEqual({ t: 'hello', v: 1, audience: 'DISPLAY', tournamentId: 'trn_1', resume: null });
    expect(sockets[0]!.sent[1]).toMatchObject({ t: 'ping' });
    sockets[0]!.receive({ t: 'display_scene', st: 900, scene: 'LEADERBOARD', tableId: null });
    expect(actions.map((a) => a.type)).toEqual(['connection', 'connection', 'frame']);
    expect(actions.at(-1)).toMatchObject({ type: 'frame', frame: { t: 'display_scene', scene: 'LEADERBOARD' } });
    // A dropped socket reports "reconnecting" (the UI greys out the data) and retries with backoff.
    sockets[0]!.close();
    expect(actions.at(-1)).toEqual({ type: 'connection', status: 'reconnecting' });
    expect(scheduler.timers.length).toBeGreaterThan(0);
    src.stop();
  });

  it('backs off to slow retries after a refusal such as DISPLAY_NOT_ALLOWED', () => {
    const sockets: FakeSocket[] = [];
    const scheduler = fakeScheduler();
    const src = createLiveSource({ tournamentId: 'trn_1', url: 'ws://x/ws', scheduler, socketFactory: () => sockets[sockets.push(new FakeSocket()) - 1]! });
    const actions: DisplayAction[] = [];
    src.start((a) => actions.push(a));
    sockets[0]!.open();
    sockets[0]!.receive({ t: 'error', st: 1, code: 'DISPLAY_NOT_ALLOWED', message: 'disabled' });
    expect(actions.at(-1)).toEqual({ type: 'connection', status: 'closed' });
    expect(scheduler.timers.map((t) => t.ms)).toContain(30_000);
    scheduler.timers.find((t) => t.ms === 30_000)!.fn();
    expect(sockets).toHaveLength(2);
    src.stop();
  });
});
