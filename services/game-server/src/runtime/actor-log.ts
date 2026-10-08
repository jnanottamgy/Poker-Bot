import { DuplicateSequenceError } from '../persistence/repos/logs';
import type { LoggedCommand, LoggedEvent, Snapshot } from '../persistence/repos/logs';
import type { ActorTransaction } from './transactions';

/**
 * Durable history of an actor: the command log (authoritative), the events
 * each command produced, and periodic state snapshots. Writes happen inside
 * the host's unit of work; reads happen outside it (recovery).
 *
 * `append` MUST throw DuplicateSequenceError when the (actor, seq) pair — or
 * the command's idempotency key, or its commandId — already exists: that is
 * the fencing mechanism against a stale owner, and the durable guard against
 * a routed request (commandId = correlationId) being applied twice.
 */
export interface ActorLog<M = unknown> {
  append(tx: ActorTransaction, actorId: string, command: LoggedCommand, events: LoggedEvent[], meta: M): Promise<void>;
  saveSnapshot(tx: ActorTransaction, actorId: string, snapshot: Snapshot): Promise<void>;
  latestSnapshot(actorId: string): Promise<Snapshot | null>;
  /** Commands with seq > afterSeq in ascending order, at most `limit`. */
  commandsAfter(actorId: string, afterSeq: number, limit: number): Promise<LoggedCommand[]>;
  /** Events with event seq > afterSeq in ascending order (enables the determinism check). */
  eventsAfter?(actorId: string, afterSeq: number, limit: number): Promise<LoggedEvent[]>;
}

/** Snapshots retained per actor (matches the PostgreSQL repos). */
const SNAPSHOTS_KEPT = 3;

interface MemoryStream {
  commands: LoggedCommand[];
  events: LoggedEvent[];
  snapshots: Snapshot[];
  actionIds: Set<string>;
  commandIds: Set<string>;
}

/** JSON round trip: the same normalization PostgreSQL JSONB applies, and isolation from callers. */
const jsonCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * In-memory log with the same contract as the PostgreSQL ones (gap-free seq,
 * unique action ids and command ids, rollback via undo hooks). For unit tests and benchmarks.
 */
export class MemoryActorLog<M = unknown> implements ActorLog<M> {
  private readonly streams = new Map<string, MemoryStream>();
  /** Every `meta` passed to append, latest per actor (lets tests assert it). */
  readonly lastMeta = new Map<string, M>();

  private stream(actorId: string): MemoryStream {
    let s = this.streams.get(actorId);
    if (!s) {
      s = { commands: [], events: [], snapshots: [], actionIds: new Set(), commandIds: new Set() };
      this.streams.set(actorId, s);
    }
    return s;
  }

  async append(tx: ActorTransaction, actorId: string, command: LoggedCommand, events: LoggedEvent[], meta: M): Promise<void> {
    const s = this.stream(actorId);
    const last = s.commands[s.commands.length - 1];
    if (last && command.seq <= last.seq) throw new DuplicateSequenceError(`actor ${actorId}`, command.seq);
    if (command.actionId !== null && s.actionIds.has(command.actionId)) throw new DuplicateSequenceError(`actor ${actorId}`, command.seq);
    if (s.commandIds.has(command.commandId)) throw new DuplicateSequenceError(`actor ${actorId}`, command.seq);
    s.commands.push(jsonCopy(command));
    if (command.actionId !== null) s.actionIds.add(command.actionId);
    s.commandIds.add(command.commandId);
    for (const e of events) s.events.push(jsonCopy(e));
    const previousMeta = this.lastMeta.get(actorId);
    this.lastMeta.set(actorId, meta);
    tx.onRollback(() => {
      s.commands.pop();
      if (command.actionId !== null) s.actionIds.delete(command.actionId);
      s.commandIds.delete(command.commandId);
      s.events.length -= events.length;
      if (previousMeta === undefined) this.lastMeta.delete(actorId);
      else this.lastMeta.set(actorId, previousMeta);
    });
  }

  async saveSnapshot(tx: ActorTransaction, actorId: string, snapshot: Snapshot): Promise<void> {
    const s = this.stream(actorId);
    if (s.snapshots.some((x) => x.commandSeq === snapshot.commandSeq)) return;
    const before = s.snapshots;
    s.snapshots = [...s.snapshots, jsonCopy(snapshot)].sort((a, b) => a.commandSeq - b.commandSeq).slice(-SNAPSHOTS_KEPT);
    tx.onRollback(() => {
      s.snapshots = before;
    });
  }

  async latestSnapshot(actorId: string): Promise<Snapshot | null> {
    const snaps = this.streams.get(actorId)?.snapshots;
    const last = snaps?.[snaps.length - 1];
    return last ? jsonCopy(last) : null;
  }

  async commandsAfter(actorId: string, afterSeq: number, limit: number): Promise<LoggedCommand[]> {
    const cmds = this.streams.get(actorId)?.commands ?? [];
    return jsonCopy(cmds.filter((c) => c.seq > afterSeq).slice(0, limit));
  }

  async eventsAfter(actorId: string, afterSeq: number, limit: number): Promise<LoggedEvent[]> {
    const evs = this.streams.get(actorId)?.events ?? [];
    return jsonCopy(evs.filter((e) => e.seq > afterSeq).slice(0, limit));
  }

  /** Test helper: number of committed commands. */
  commandCount(actorId: string): number {
    return this.streams.get(actorId)?.commands.length ?? 0;
  }
}
