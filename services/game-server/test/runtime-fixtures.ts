import type { ActorDefinition, ActorEnvelope, ActorEvent, StepResult } from '../src/runtime/actor';
import { noopResult, stepResult } from '../src/runtime/actor';
import type { TableLogMeta } from '../src/runtime/pg-actor-log';
import type { Database } from '../src/persistence/db';
import { Store } from '../src/persistence/store';
import type { Repos } from '../src/persistence/store';
import { createTestDatabase } from './helpers/db';

/**
 * Toy deterministic actor for runtime tests: a bank ledger with transfers,
 * idempotent request ids and a periodic interest timer. Pure: no clock, no
 * randomness, inputs never mutated.
 */
export interface BankState {
  version: number;
  eventSeq: number;
  accounts: Record<string, number>;
  /** requestId -> command seq that applied it (idempotency). */
  requests: Record<string, number>;
  interest: { rateBp: number; everyMs: number; nextAt: number; token: string } | null;
  interestRuns: number;
}

export type BankCommand =
  | { type: 'OPEN'; requestId: string; account: string; initial: number }
  | { type: 'TRANSFER'; requestId: string; from: string; to: string; amount: number }
  | { type: 'START_INTEREST'; rateBp: number; everyMs: number }
  | { type: 'STOP_INTEREST' }
  | { type: 'TIMER'; key: string; token: string }
  | { type: 'BOOM' };

export type BankReply = { ok: true; seq: number; duplicate?: boolean } | { ok: false; code: string };

export interface BankOptions {
  kind?: string;
  snapshotEvery?: number;
  /** Write balances to the bank_projection table inside the command transaction. */
  projection?: boolean;
}

export const INTEREST_KEY = 'interest';

const BP = 10_000;

export function bankActor(opts: BankOptions = {}): ActorDefinition<BankState, BankCommand, BankReply, TableLogMeta> {
  return {
    kind: opts.kind ?? 'table',
    snapshotEvery: opts.snapshotEvery ?? 250,
    initialState: () => ({ version: 0, eventSeq: 0, accounts: {}, requests: {}, interest: null, interestRuns: 0 }),
    step: (state, env) => bankStep(state, env, opts),
    commandType: (c) => c.type,
    actionIdOf: (c) => ('requestId' in c ? c.requestId : null),
    timerCommand: (key, token) => ({ type: 'TIMER', key, token }),
    pendingTimers: (s) => (s.interest ? [{ key: INTEREST_KEY, at: s.interest.nextAt, token: s.interest.token }] : []),
    logMeta: (s) => ({ status: 'BETWEEN_HANDS', playerCount: Object.keys(s.accounts).length, handsPlayed: s.interestRuns, progressed: true }),
    versionOf: (s) => s.version,
    eventSeqOf: (s) => s.eventSeq,
  };
}

function bankStep(state: BankState, env: ActorEnvelope<BankCommand>, opts: BankOptions): StepResult<BankState, BankReply> {
  const c = env.command;
  const emit = (next: BankState, kind: string, payload: unknown, extra: Partial<StepResult<BankState, BankReply>> = {}) => {
    const event: ActorEvent = { seq: state.eventSeq + 1, version: state.version + 1, at: env.at, kind, visibility: 'PUBLIC', privateTo: null, payload };
    const after: BankState = { ...next, version: state.version + 1, eventSeq: event.seq };
    return stepResult<BankState, BankReply>(after, { ok: true, seq: env.seq }, {
      events: [event],
      outbox: [{ channel: `bank:${env.actorId}:events`, message: { seq: env.seq, event } }],
      ...(opts.projection ? { projection: projectBalances(env.actorId, after.accounts) } : {}),
      ...extra,
    });
  };

  switch (c.type) {
    case 'OPEN': {
      if (state.requests[c.requestId] !== undefined) return noopResult(state, { ok: true, seq: state.requests[c.requestId]!, duplicate: true });
      if (state.accounts[c.account] !== undefined) return noopResult(state, { ok: false, code: 'EXISTS' });
      return emit(
        { ...state, accounts: { ...state.accounts, [c.account]: c.initial }, requests: { ...state.requests, [c.requestId]: env.seq } },
        'OPENED',
        { account: c.account, initial: c.initial },
      );
    }
    case 'TRANSFER': {
      if (state.requests[c.requestId] !== undefined) return noopResult(state, { ok: true, seq: state.requests[c.requestId]!, duplicate: true });
      const from = state.accounts[c.from];
      const to = state.accounts[c.to];
      if (from === undefined || to === undefined) return noopResult(state, { ok: false, code: 'NO_ACCOUNT' });
      if (!Number.isSafeInteger(c.amount) || c.amount <= 0 || from < c.amount) return noopResult(state, { ok: false, code: 'INSUFFICIENT' });
      const accounts = { ...state.accounts, [c.from]: from - c.amount };
      accounts[c.to] = accounts[c.to]! + c.amount;
      return emit({ ...state, accounts, requests: { ...state.requests, [c.requestId]: env.seq } }, 'TRANSFERRED', { from: c.from, to: c.to, amount: c.amount });
    }
    case 'START_INTEREST': {
      const interest = { rateBp: c.rateBp, everyMs: c.everyMs, nextAt: env.at + c.everyMs, token: `int-${env.seq}` };
      return emit({ ...state, interest }, 'INTEREST_STARTED', { rateBp: c.rateBp, everyMs: c.everyMs }, {
        timers: [{ key: INTEREST_KEY, at: interest.nextAt, token: interest.token }],
      });
    }
    case 'STOP_INTEREST':
      if (!state.interest) return noopResult(state, { ok: false, code: 'NOT_RUNNING' });
      return emit({ ...state, interest: null }, 'INTEREST_STOPPED', {}, { cancelTimers: [INTEREST_KEY] });
    case 'TIMER': {
      const it = state.interest;
      if (c.key !== INTEREST_KEY || !it || c.token !== it.token) return noopResult(state, { ok: false, code: 'STALE_TIMER' });
      const accounts: Record<string, number> = {};
      for (const [a, bal] of Object.entries(state.accounts)) accounts[a] = bal + Math.floor((bal * it.rateBp) / BP);
      const interest = { ...it, nextAt: it.nextAt + it.everyMs, token: `int-${env.seq}` };
      return emit({ ...state, accounts, interest, interestRuns: state.interestRuns + 1 }, 'INTEREST_APPLIED', { run: state.interestRuns + 1 }, {
        timers: [{ key: INTEREST_KEY, at: interest.nextAt, token: interest.token }],
      });
    }
    case 'BOOM':
      throw new Error('ledger invariant broken (test)');
  }
}

function projectBalances(actorId: string, accounts: Record<string, number>) {
  const rows = Object.entries(accounts);
  return async (repos: Repos) => {
    if (!rows.length) return;
    const values: unknown[] = [];
    const tuples = rows.map(([a, b], i) => {
      values.push(actorId, a, b);
      return `($${i * 3 + 1},$${i * 3 + 2},$${i * 3 + 3})`;
    });
    await repos.q.query(
      `INSERT INTO bank_projection (actor_id, account, balance) VALUES ${tuples.join(',')}
       ON CONFLICT (actor_id, account) DO UPDATE SET balance = EXCLUDED.balance`,
      values,
    );
  };
}

export const open = (account: string, initial: number): BankCommand => ({ type: 'OPEN', requestId: `open-${account}`, account, initial });
export const transfer = (requestId: string, from: string, to: string, amount: number): BankCommand => ({ type: 'TRANSFER', requestId, from, to, amount });

/** Deterministic pseudo-random sequence for test inputs (never Math.random). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ------------------------------------------------------------------ PostgreSQL

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

export interface PgFixture {
  db: Database;
  store: Store;
  /** Creates a tables row (FK target of table_commands) and returns its id. */
  table(id: string): Promise<string>;
  /** Creates a tournaments row (FK target of director_inputs) and returns its id. */
  tournament(id: string): Promise<string>;
  balances(actorId: string): Promise<Record<string, number>>;
  close(): Promise<void>;
}

const TOURNAMENT = 'trn_runtime';

export async function pgFixture(name: string): Promise<PgFixture> {
  const db = await createTestDatabase(name);
  const store = new Store(db);
  let tableNumber = 0;
  const tournament = async (id: string) => {
    await db.query(
      `INSERT INTO tournaments (id, join_code, name, status, config, server_seed_hash, server_seed_enc) VALUES ($1, $2, $1, 'DRAFT', '{}', 'h', 'e')`,
      [id, id.toUpperCase().slice(-12)],
    );
    return id;
  };
  await tournament(TOURNAMENT);
  await db.query(`CREATE TABLE bank_projection (actor_id TEXT NOT NULL, account TEXT NOT NULL, balance BIGINT NOT NULL, PRIMARY KEY (actor_id, account))`);
  return {
    db,
    store,
    tournament,
    async table(id) {
      await store.repos.tableLogs.createTable({ id, tournamentId: TOURNAMENT, tableNumber: ++tableNumber, maxSeats: 9, status: 'WAITING', isFinalTable: false });
      return id;
    },
    async balances(actorId) {
      const r = await db.query<{ account: string; balance: number }>(`SELECT account, balance FROM bank_projection WHERE actor_id = $1`, [actorId]);
      return Object.fromEntries(r.rows.map((row) => [row.account, row.balance]));
    },
    close: () => store.close(),
  };
}

/** A controllable promise. */
export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Polls `cond` (real time) until true or the timeout elapses. */
export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 10_000, stepMs = 20): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return;
    if (Date.now() > until) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
