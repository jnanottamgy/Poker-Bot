import { beforeEach, describe, expect, it } from 'vitest';
import { ClockSync, JpbClient, newActionId, newClientSeed, readCookie, websocketUrl } from '../src';
import { FakeScheduler, FakeSocket } from './fakes';

function makeClient(scheduler = new FakeScheduler()) {
  const client = new JpbClient({
    url: 'ws://test/ws',
    audience: 'PLAYER',
    tournamentId: 'trn_1',
    scheduler,
    socketFactory: (url) => new FakeSocket(url),
    actionTimeoutMs: 5000,
  });
  return { client, scheduler };
}

const tableView = (seq: number) => ({
  audience: 'PLAYER',
  tableId: 'T1',
  tournamentId: 'trn_1',
  tableNumber: 1,
  version: seq,
  lastEventSeq: seq,
  status: 'IN_HAND',
  holds: [],
  frozen: false,
  maxSeats: 9,
  seats: [],
  buttonSeat: 0,
  blinds: { level: 1, smallBlind: 50, bigBlind: 100, ante: 0, anteType: 'NONE' },
  hand: null,
  serverTime: 0,
  you: { playerId: 'p1', seat: 0, holeCards: null, legal: null },
});

beforeEach(() => {
  FakeSocket.instances = [];
});

describe('clock sync', () => {
  it('uses the minimum-RTT sample', () => {
    const c = new ClockSync();
    c.recordPong(1000, 6050, 1100); // rtt 100 => offset 6050+50-1100 = 5000
    c.recordPong(2000, 7010, 2020); // rtt 20  => offset 7010+10-2020 = 5000
    c.recordPong(3000, 9000, 3400); // rtt 400 => offset 5800 (noisy)
    expect(c.offsetMs).toBe(5000);
    expect(c.rttMs).toBe(20);
    expect(c.remainingMs(20_000, 10_000)).toBe(5000);
    expect(c.remainingMs(1, 10_000)).toBe(0);
  });
});

describe('connection lifecycle', () => {
  it('sends hello on open, applies snapshot, answers pings and reconnects with backoff', () => {
    const { client, scheduler } = makeClient();
    client.connect();
    expect(client.store.getState().connection).toBe('connecting');
    const s1 = FakeSocket.latest();
    s1.serverOpen();
    expect(s1.sent[0]).toMatchObject({ t: 'hello', audience: 'PLAYER', tournamentId: 'trn_1', resume: null });
    expect(s1.sent[1]).toMatchObject({ t: 'ping' });
    s1.serverSend({ t: 'pong', st: scheduler.now() + 5000, ct: scheduler.now() });
    expect(client.store.getState().serverOffsetMs).toBe(5000);

    s1.serverDrop();
    expect(client.store.getState().connection).toBe('reconnecting');
    scheduler.advance(1000);
    const s2 = FakeSocket.latest();
    expect(s2).not.toBe(s1);
    s2.serverOpen();
    expect(client.store.getState().connection).toBe('open');
  });

  it('detects a dead socket via heartbeat timeout', () => {
    const { client, scheduler } = makeClient();
    client.connect();
    FakeSocket.latest().serverOpen();
    const before = FakeSocket.instances.length;
    scheduler.advance(40_000);
    expect(FakeSocket.instances.length).toBeGreaterThan(before);
  });

  it('stops reconnecting when the session is replaced by another device', () => {
    const { client, scheduler } = makeClient();
    client.connect();
    const s = FakeSocket.latest();
    s.serverOpen();
    s.serverSend({ t: 'session_replaced', st: 0 });
    expect(client.store.getState().connection).toBe('replaced');
    scheduler.advance(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('resumes with a cursor after reconnecting', () => {
    const { client, scheduler } = makeClient();
    client.connect();
    const s1 = FakeSocket.latest();
    s1.serverOpen();
    s1.serverSend({ t: 'table_update', st: 0, tableId: 'T1', fromSeq: 1, toSeq: 7, version: 7, events: [], view: tableView(7) });
    s1.serverDrop();
    scheduler.advance(2000);
    const s2 = FakeSocket.latest();
    s2.serverOpen();
    expect(s2.sent[0]).toMatchObject({ t: 'hello', resume: { tableId: 'T1', tableSeq: 7 } });
  });
});

describe('server state always wins', () => {
  it('replaces the table view on every update and requests a snapshot on gaps', () => {
    const { client } = makeClient();
    client.connect();
    const s = FakeSocket.latest();
    s.serverOpen();
    s.serverSend({ t: 'table_update', st: 0, tableId: 'T1', fromSeq: 1, toSeq: 3, version: 3, events: [], view: tableView(3) });
    expect(client.store.getState().table?.version).toBe(3);
    s.serverSend({ t: 'table_update', st: 0, tableId: 'T1', fromSeq: 9, toSeq: 9, version: 9, events: [], view: tableView(9) });
    expect(client.store.getState().table?.version).toBe(9);
    expect(s.sent.some((m) => (m as { t: string }).t === 'snapshot_request')).toBe(true);
  });

  it('clears the old table when the player is moved', () => {
    const { client } = makeClient();
    client.connect();
    const s = FakeSocket.latest();
    s.serverOpen();
    s.serverSend({ t: 'self_update', st: 0, self: { playerId: 'p1', publicId: 'JPN-1', displayName: 'A', status: 'SEATED', tableId: 'T1', tableNumber: 1, seat: 0, stack: 100, finishPosition: null, prizeMinor: 0, handsPlayed: 0 } });
    s.serverSend({ t: 'table_update', st: 0, tableId: 'T1', fromSeq: 1, toSeq: 3, version: 3, events: [], view: tableView(3) });
    s.serverSend({ t: 'self_update', st: 0, self: { playerId: 'p1', publicId: 'JPN-1', displayName: 'A', status: 'SEATED', tableId: 'T2', tableNumber: 2, seat: 4, stack: 100, finishPosition: null, prizeMinor: 0, handsPlayed: 0 } });
    expect(client.store.getState().table).toBeNull();
  });
});

describe('actions are idempotent and never optimistic', () => {
  it('resends the same actionId after reconnect and resolves once', async () => {
    const { client, scheduler } = makeClient();
    client.connect();
    const s1 = FakeSocket.latest();
    s1.serverOpen();
    const p = client.act({ tableId: 'T1', type: 'CALL', tableStateVersion: 12 });
    expect(client.store.getState().pendingAction?.type).toBe('CALL');
    const first = s1.sent.find((m) => (m as { t: string }).t === 'action') as { actionId: string };
    s1.serverDrop();
    scheduler.advance(2000);
    const s2 = FakeSocket.latest();
    s2.serverOpen();
    const resent = s2.sent.find((m) => (m as { t: string }).t === 'action') as { actionId: string };
    expect(resent.actionId).toBe(first.actionId);
    s2.serverSend({ t: 'action_result', st: 0, actionId: first.actionId, ok: true, code: null, message: null });
    s2.serverSend({ t: 'action_result', st: 0, actionId: first.actionId, ok: true, code: null, message: null });
    await expect(p).resolves.toMatchObject({ ok: true });
    expect(client.store.getState().pendingAction).toBeNull();
  });

  it('refuses a second concurrent action at the same table and times out to unknown', async () => {
    const { client, scheduler } = makeClient();
    client.connect();
    FakeSocket.latest().serverOpen();
    const p1 = client.act({ tableId: 'T1', type: 'RAISE', amount: 500, tableStateVersion: 1 });
    await expect(client.act({ tableId: 'T1', type: 'FOLD', tableStateVersion: 1 })).resolves.toMatchObject({ ok: false });
    scheduler.advance(6000);
    await expect(p1).resolves.toMatchObject({ ok: false, code: 'TIMEOUT', unknown: true });
  });
});

describe('helpers', () => {
  it('generates well-formed ids and seeds', () => {
    expect(newActionId()).toMatch(/^ACT-[0-9A-HJKMNP-TV-Z]{20}$/);
    expect(newClientSeed()).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(Array.from({ length: 500 }, newActionId)).size).toBe(500);
  });
  it('reads cookies and builds ws urls', () => {
    expect(readCookie('jpb_csrf', 'a=1; jpb_csrf=xyz%3D; b=2')).toBe('xyz=');
    expect(websocketUrl('/ws', { protocol: 'https:', host: 'poker.example' })).toBe('wss://poker.example/ws');
  });
});
