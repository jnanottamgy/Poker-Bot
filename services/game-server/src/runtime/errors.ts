/**
 * Typed errors of the actor runtime. Every rejection a caller can receive is
 * one of these codes, so the HTTP/WebSocket layers can map them without
 * parsing messages, and they survive a bus round trip (toWire/fromWire).
 *
 * `processed` tells the caller what happened to the command:
 *   'no'      — guaranteed not applied; safe to retry as-is.
 *   'unknown' — may or may not have been applied (timeouts, ambiguous
 *               commits); retry only with the same idempotency key.
 */
export type ActorErrorCode =
  /** This node does not (or no longer) own the actor. */
  | 'NOT_OWNER'
  /** No owner reachable within the deadline, or ownership could not be acquired. */
  | 'UNAVAILABLE'
  /** The actor halted after an invariant break (step threw); an operator must intervene. */
  | 'FAULTED'
  /** The transaction failed (database down, serialization error...). State was not advanced. */
  | 'PERSISTENCE_FAILED'
  /** Another owner already appended this sequence number (split-brain fencing). */
  | 'FENCED'
  /** The database rejected the command's idempotency key (action id already logged). */
  | 'CONFLICT'
  /** Replaying the log did not reproduce the recorded history. */
  | 'NONDETERMINISTIC'
  | 'UNKNOWN_ACTOR_KIND';

const RETRYABLE: ReadonlySet<ActorErrorCode> = new Set(['NOT_OWNER', 'UNAVAILABLE', 'PERSISTENCE_FAILED', 'FENCED']);

export class ActorRuntimeError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: ActorErrorCode,
    message: string,
    readonly processed: 'no' | 'unknown' = 'no',
  ) {
    super(message);
    this.name = 'ActorRuntimeError';
    this.retryable = RETRYABLE.has(code);
  }

  toWire(): WireError {
    return { code: this.code, message: this.message, processed: this.processed };
  }

  static fromWire(w: WireError): ActorRuntimeError {
    return new ActorRuntimeError(w.code, w.message, w.processed);
  }
}

export interface WireError {
  code: ActorErrorCode;
  message: string;
  processed: 'no' | 'unknown';
}

export const isActorError = (err: unknown, code?: ActorErrorCode): err is ActorRuntimeError =>
  err instanceof ActorRuntimeError && (code === undefined || err.code === code);

/** Raised when a replayed log does not reproduce the recorded events. */
export class DeterminismError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeterminismError';
  }
}

/** `step` threw while replaying a logged command (a code bug, never a data problem). */
export class ReplayStepError extends Error {
  constructor(
    readonly seq: number,
    cause: unknown,
  ) {
    super(`step threw while replaying command ${seq}: ${(cause as Error)?.message ?? String(cause)}`, { cause });
    this.name = 'ReplayStepError';
  }
}
