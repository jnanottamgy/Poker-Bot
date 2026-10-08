import type { Repos } from '../persistence/store';
import type { LoggedCommand, LoggedEvent, Snapshot } from '../persistence/repos/logs';
import type { ActorLog } from './actor-log';
import type { ActorTransaction } from './transactions';

/**
 * PostgreSQL actor logs backed by the existing repositories. Reads use the
 * pool-bound repos given to the constructor; writes use the transaction's.
 *
 * Snapshot state is stored as JSON text (a JSONB string) rather than as a
 * JSONB object: JSONB reorders object keys, and a state restored from a
 * snapshot must iterate exactly like the live state it was taken from.
 * (Commands stay JSONB objects; the host canonicalizes their key order.)
 */
const encodeState = (state: unknown): string => JSON.stringify(state);
/** Rows written before this encoding hold the object itself. */
const decodeState = (stored: unknown): unknown => (typeof stored === 'string' ? (JSON.parse(stored) as unknown) : stored);

/** Columns of the `tables` row maintained with every table command. */
export interface TableLogMeta {
  status: string;
  playerCount: number;
  handsPlayed: number;
  /** Whether the command made game progress (feeds `last_progress_at` / stall detection). */
  progressed: boolean;
}

/** table_commands / table_events / table_snapshots (+ the `tables` meta row). */
export class PostgresTableLog implements ActorLog<TableLogMeta> {
  constructor(private readonly repos: Pick<Repos, 'tableLogs'>) {}

  async append(tx: ActorTransaction, actorId: string, command: LoggedCommand, events: LoggedEvent[], meta: TableLogMeta): Promise<void> {
    if (!meta) throw new Error('PostgresTableLog requires logMeta (status, playerCount, handsPlayed, progressed)');
    await tx.repos.tableLogs.append(actorId, command, events, meta);
  }

  async saveSnapshot(tx: ActorTransaction, actorId: string, snapshot: Snapshot): Promise<void> {
    await tx.repos.tableLogs.saveSnapshot(actorId, { ...snapshot, state: encodeState(snapshot.state) });
  }

  async latestSnapshot(actorId: string): Promise<Snapshot | null> {
    const s = await this.repos.tableLogs.latestSnapshot(actorId);
    return s ? { ...s, state: decodeState(s.state) } : null;
  }

  commandsAfter(actorId: string, afterSeq: number, limit: number): Promise<LoggedCommand[]> {
    return this.repos.tableLogs.commandsAfter(actorId, afterSeq, limit);
  }

  eventsAfter(actorId: string, afterSeq: number, limit: number): Promise<LoggedEvent[]> {
    return this.repos.tableLogs.eventsAfter(actorId, afterSeq, limit);
  }
}

/**
 * The `director_inputs.input` column stores this wrapper so the recorded
 * commandId and idempotency key survive for replay (the table has no
 * dedicated columns for them).
 */
export interface DirectorInputRecord<C = unknown> {
  commandId: string;
  actionId: string | null;
  command: C;
}

/**
 * director_inputs / tournament_events / director_snapshots. Tournament events
 * are public by construction (the table has no visibility columns), so a
 * PRIVATE director event is rejected and the command is not committed. Event
 * and snapshot `version` are not stored: reads report the seq instead.
 */
export class PostgresDirectorLog implements ActorLog<unknown> {
  constructor(private readonly repos: Pick<Repos, 'directorLogs'>) {}

  async append(tx: ActorTransaction, actorId: string, command: LoggedCommand, events: LoggedEvent[]): Promise<void> {
    const privateEvent = events.find((e) => e.visibility !== 'PUBLIC' || e.privateTo !== null);
    if (privateEvent) throw new Error(`Director events must be PUBLIC (event ${privateEvent.seq} ${privateEvent.kind})`);
    const input: DirectorInputRecord = { commandId: command.commandId, actionId: command.actionId, command: command.command };
    await tx.repos.directorLogs.append(actorId, { seq: command.seq, at: command.at, type: command.type, input });
    await tx.repos.directorLogs.appendEvents(
      actorId,
      events.map((e) => ({ seq: e.seq, at: e.at, kind: e.kind, payload: e.payload })),
    );
  }

  async saveSnapshot(tx: ActorTransaction, actorId: string, snapshot: Snapshot): Promise<void> {
    await tx.repos.directorLogs.saveSnapshot(actorId, { inputSeq: snapshot.commandSeq, at: snapshot.at, state: encodeState(snapshot.state) });
  }

  async latestSnapshot(actorId: string): Promise<Snapshot | null> {
    const s = await this.repos.directorLogs.latestSnapshot(actorId);
    return s ? { commandSeq: s.inputSeq, version: s.inputSeq, at: s.at, state: decodeState(s.state) } : null;
  }

  async commandsAfter(actorId: string, afterSeq: number, limit: number): Promise<LoggedCommand[]> {
    const rows = await this.repos.directorLogs.inputsAfter<DirectorInputRecord>(actorId, afterSeq, limit);
    return rows.map((r) => ({ seq: r.seq, at: r.at, type: r.type, commandId: r.input.commandId, actionId: r.input.actionId, command: r.input.command }));
  }

  async eventsAfter(actorId: string, afterSeq: number, limit: number): Promise<LoggedEvent[]> {
    const rows = await this.repos.directorLogs.eventsAfter(actorId, afterSeq, limit);
    return rows.map((r) => ({ seq: r.seq, version: r.seq, at: r.at, kind: r.kind, visibility: 'PUBLIC', privateTo: null, payload: r.payload }));
  }
}
