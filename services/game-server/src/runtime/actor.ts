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

export const poolOf = (def: Pick<AnyActorDefinition, 'kind' | 'pool'>): ActorPool => def.pool ?? (def.kind === 'director' ? 'orchestrator' : 'worker');

export function commandChannelOf(def: Pick<AnyActorDefinition, 'kind' | 'commandChannel'>, actorId: string): string {
  if (def.commandChannel) return def.commandChannel(actorId);
  if (def.kind === 'table') return channels.tableCommands(actorId);
  if (def.kind === 'director') return channels.directorInputs(actorId);
  return `${def.kind}:${actorId}:cmd`;
}

/** Lease / registry key of an actor. Kinds never contain ':' so the first ':' splits it. */
export const actorAddress = (kind: string, actorId: string): string => `${kind}:${actorId}`;
