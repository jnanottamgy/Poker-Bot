import type { Repos } from '../persistence/store';
import type { LoggedEvent } from '../persistence/repos/logs';
import { channels } from '../bus/bus';

/**
 * The generic actor contract. The runtime knows nothing about poker: table
 * actors and the tournament director plug in through an ActorDefinition.
 *
 * `step` MUST be pure and deterministic: same (state, envelope) => same
 * result, no I/O, no clock reads, no randomness except what is derived from
 * state/envelope, and no mutation of its inputs. Replaying the command log
 * through `step` with the recorded envelopes is how crash recovery works.
 */
export type ActorKind = 'table' | 'director' | (string & {});

/** Which node pool may host an actor kind (spec: tables on workers, directors on orchestrators). */
export type ActorPool = 'worker' | 'orchestrator';

export interface ActorEnvelope<C> {
  actorId: string;
  /** Gap-free per-actor command sequence (1-based). */
  seq: number;
  /** Random id of this processing; recorded in the log. */
  commandId: string;
  /** Server time the actor processed the command; never decreases per actor; replay reuses it. */
  at: number;
  command: C;
}

export interface TimerRequest {
  /** One live timer per (actor, key): scheduling a key again replaces the previous timer. */
  key: string;
  /** Absolute server time (epoch ms). */
  at: number;
  /** Opaque token handed back in the timer command; stale tokens must be ignored by `step`. */
  token: string;
}

export interface OutboxMessage {
  channel: string;
  message: unknown;
}

export type ActorEvent = LoggedEvent;

export interface StepResult<S, R> {
  state: S;
  events: ActorEvent[];
  timers: TimerRequest[];
  cancelTimers: string[];
  reply: R;
  /** Published on the bus only after the transaction commits (at-most-once). */
  outbox: OutboxMessage[];
  /**
   * Duplicate / idempotent / rejected-without-effect command: nothing is
   * persisted and `state` is discarded. A noop must not carry events, timers,
   * outbox messages or a projection (the host faults the actor if it does).
   */
  noop?: boolean;
  /** Projection writes, executed inside the same transaction as the log append. Skipped during replay. */
  projection?: (repos: Repos) => Promise<void>;
}

export interface ActorDefinition<S, C, R, M = undefined> {
  kind: ActorKind;
  /** Defaults to 'orchestrator' for kind 'director', 'worker' otherwise. */
  pool?: ActorPool;
  /** Snapshot after every N committed commands (env SNAPSHOT_EVERY_COMMANDS). */
  snapshotEvery: number;
  /** State before the first command when no snapshot exists. */
  initialState(actorId: string): S;
  step(state: S, envelope: ActorEnvelope<C>): StepResult<S, R>;
  /** Short type string stored in the log's `type` column. */
  commandType(command: C): string;
  /** Idempotency key stored in the log (UNIQUE per actor for tables), or null. */
  actionIdOf(command: C): string | null;
  /** Command submitted to the actor when timer `key` fires. */
  timerCommand(key: string, token: string): C;
  /** Timers that must be armed for this state (used after recovery). */
  pendingTimers(state: S): TimerRequest[];
  /** Per-command metadata required by the log (e.g. the `tables` row counters). */
  logMeta?(state: S, envelope: ActorEnvelope<C>): M;
  /** State version recorded with snapshots; defaults to the command seq. */
  versionOf?(state: S): number;
  /**
   * Last event seq contained in `state`. When provided the host enforces a
   * gap-free event stream (first new event = this + 1).
   */
  eventSeqOf?(state: S): number;
  /** Snapshot (de)serialization; state is plain JSON so both default to identity. */
  toSnapshot?(state: S): unknown;
  fromSnapshot?(raw: unknown): S;
  /** Bus channel on which the owner receives routed commands (defaults by kind). */
  commandChannel?(actorId: string): string;
}

// The registry stores definitions of different S/C/R/M side by side.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyActorDefinition = ActorDefinition<any, any, any, any>;

/** Builds a StepResult with empty effect lists. */
export function stepResult<S, R>(state: S, reply: R, effects: Partial<Omit<StepResult<S, R>, 'state' | 'reply'>> = {}): StepResult<S, R> {
  return { state, reply, events: [], timers: [], cancelTimers: [], outbox: [], ...effects };
}

/** A command with no effect: nothing is persisted, the reply is returned as-is. */
export function noopResult<S, R>(state: S, reply: R): StepResult<S, R> {
  return { ...stepResult(state, reply), noop: true };
}

/**
 * Structural invariants of a step result, enforced live (a violation faults
 * the actor) and on replay (a violation fails recovery): well-formed effect
 * lists, a noop without effects, a gap-free event stream when `eventSeqOf` is
 * defined, and valid timer requests.
 */
export function checkStepResult<S>(def: Pick<AnyActorDefinition, 'eventSeqOf'>, prev: S, r: StepResult<S, unknown>): void {
  if (!r || !Array.isArray(r.events) || !Array.isArray(r.timers) || !Array.isArray(r.cancelTimers) || !Array.isArray(r.outbox)) {
    throw new Error('step returned a malformed result');
  }
  if (r.noop) {
    if (r.events.length || r.timers.length || r.cancelTimers.length || r.outbox.length || r.projection) throw new Error('noop result carries effects');
    return;
  }
  let last: number = def.eventSeqOf ? def.eventSeqOf(prev) : (r.events[0]?.seq ?? 1) - 1;
  for (const e of r.events) {
    if (e.seq !== last + 1) throw new Error(`event seq ${e.seq} breaks the gap-free stream (expected ${last + 1})`);
    last = e.seq;
  }
  if (def.eventSeqOf && def.eventSeqOf(r.state) !== last) throw new Error(`state event seq ${def.eventSeqOf(r.state)} does not match last event ${last}`);
  for (const t of r.timers) {
    if (!t.key || !Number.isFinite(t.at)) throw new Error(`invalid timer request ${JSON.stringify(t)}`);
  }
}

export const poolOf =(def: Pick<AnyActorDefinition, 'kind' | 'pool'>): ActorPool => def.pool ?? (def.kind === 'director' ? 'orchestrator' : 'worker');

export function commandChannelOf(def: Pick<AnyActorDefinition, 'kind' | 'commandChannel'>, actorId: string): string {
  if (def.commandChannel) return def.commandChannel(actorId);
  if (def.kind === 'table') return channels.tableCommands(actorId);
  if (def.kind === 'director') return channels.directorInputs(actorId);
  return `${def.kind}:${actorId}:cmd`;
}

/** Lease / registry key of an actor. Kinds never contain ':' so the first ':' splits it. */
export const actorAddress = (kind: string, actorId: string): string => `${kind}:${actorId}`;
