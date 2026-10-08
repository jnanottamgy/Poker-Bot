import type { LoggedCommand, LoggedEvent } from '../persistence/repos/logs';
import { canonicalJson } from '../util/canonical-json';
import type { ActorDefinition, ActorEvent, StepResult } from './actor';
import { checkStepResult } from './actor';
import { canonicalCopy } from './canonical';
import type { ActorLog } from './actor-log';
import { DeterminismError, ReplayStepError } from './errors';

/**
 * Rebuilds an actor's state from its log: latest snapshot (optional) + replay
 * of every later command through the pure `step`, using the RECORDED
 * seq/commandId/at. Replay persists nothing, publishes nothing and runs no
 * projections or timers.
 */
export interface RecoveryReport {
  /** Command seq of the snapshot used (0 = none). */
  snapshotSeq: number;
  replayedCommands: number;
  replayedEvents: number;
  /** Last command seq after recovery. */
  seq: number;
  /** Whether the replayed events were compared with the logged ones. */
  verified: boolean;
}

export interface RecoveredActor<S> {
  state: S;
  seq: number;
  /** `at` of the last command (0 if none): the floor for the next envelope's `at`. */
  lastAt: number;
  report: RecoveryReport;
}

/** A committed state already in memory (state after command `seq`). */
export interface RecoveryStart<S> {
  state: S;
  seq: number;
  lastAt: number;
}

export interface RecoveryOptions<S = unknown> {
  /** Start from the latest snapshot (default true). False replays the whole log. */
  useSnapshot?: boolean;
  /** Continue from this committed state instead of a snapshot (catching up after an ambiguous commit). */
  from?: RecoveryStart<S>;
  /** Stop after this command (rebuilds a past state). Disables `verify`. */
  untilSeq?: number;
  /** Compare replayed events with the logged events (determinism check). */
  verify?: boolean;
  pageSize?: number;
}

const DEFAULT_PAGE = 1000;

export async function recoverActor<S, C, R, M>(
  def: ActorDefinition<S, C, R, M>,
  log: ActorLog<M>,
  actorId: string,
  opts: RecoveryOptions<S> = {},
): Promise<RecoveredActor<S>> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE;
  const until = opts.untilSeq ?? Infinity;
  const start = opts.from ?? (await loadStart(def, log, actorId, opts.useSnapshot !== false, until));
  let { state, seq, lastAt } = start;
  const snapshotSeq = opts.from ? 0 : seq;
  const verify = opts.verify === true && opts.untilSeq === undefined && typeof log.eventsAfter === 'function';
  const replayed: ActorEvent[] = [];
  let replayedEvents = 0;
  let replayedCommands = 0;

  for (;;) {
    const want = Math.min(pageSize, until - seq);
    if (want <= 0) break;
    const page = await log.commandsAfter(actorId, seq, want);
    for (const cmd of page) {
      if (cmd.seq !== seq + 1) throw new DeterminismError(`${actorId}: command log gap (expected seq ${seq + 1}, found ${cmd.seq})`);
      const result = replayOne(def, state, actorId, cmd);
      state = result.state;
      seq = cmd.seq;
      lastAt = cmd.at;
      replayedCommands++;
      replayedEvents += result.events.length;
      if (verify) replayed.push(...result.events);
    }
    if (page.length < want) break;
  }

  if (verify) await verifyEvents(def, log, actorId, state, replayed);
  return { state, seq, lastAt, report: { snapshotSeq, replayedCommands, replayedEvents, seq, verified: verify } };
}

/** Latest usable snapshot (not newer than `until`), else the initial state. */
async function loadStart<S, C, R, M>(def: ActorDefinition<S, C, R, M>, log: ActorLog<M>, actorId: string, useSnapshot: boolean, until: number): Promise<RecoveryStart<S>> {
  const snap = useSnapshot ? await log.latestSnapshot(actorId) : null;
  if (!snap || snap.commandSeq > until) return { state: def.initialState(actorId), seq: 0, lastAt: 0 };
  return { state: def.fromSnapshot ? def.fromSnapshot(snap.state) : (snap.state as S), seq: snap.commandSeq, lastAt: snap.at };
}

/** Re-runs one logged command exactly as it ran live: recorded envelope, canonical command, same result checks. */
export function replayOne<S, C, R, M>(def: ActorDefinition<S, C, R, M>, state: S, actorId: string, cmd: LoggedCommand): StepResult<S, R> {
  let result: StepResult<S, R>;
  try {
    result = def.step(state, { actorId, seq: cmd.seq, commandId: cmd.commandId, at: cmd.at, command: canonicalCopy(cmd.command) as C });
  } catch (err) {
    throw new ReplayStepError(cmd.seq, err);
  }
  if (result.noop) throw new DeterminismError(`${actorId}: logged command ${cmd.seq} (${cmd.type}) replayed as a noop`);
  try {
    checkStepResult(def, state, result);
  } catch (err) {
    throw new ReplayStepError(cmd.seq, err);
  }
  return result;
}

const comparable = (e: LoggedEvent) => canonicalJson({ seq: e.seq, at: e.at, kind: e.kind, payload: e.payload });

/**
 * Determinism check: the replayed events must equal the logged ones (same
 * count, seqs, kinds, times and payloads) and the log must contain no event
 * beyond the last replayed one.
 */
async function verifyEvents<S>(
  def: Pick<ActorDefinition<S, unknown, unknown, unknown>, 'eventSeqOf'>,
  log: ActorLog<unknown>,
  actorId: string,
  state: S,
  replayed: ActorEvent[],
): Promise<void> {
  const eventsAfter = log.eventsAfter!.bind(log);
  const first = replayed[0];
  const after = first ? first.seq - 1 : def.eventSeqOf ? def.eventSeqOf(state) : null;
  if (after === null) return;
  const logged: LoggedEvent[] = [];
  for (;;) {
    const page = await eventsAfter(actorId, logged.length ? logged[logged.length - 1]!.seq : after, DEFAULT_PAGE);
    logged.push(...page);
    if (page.length < DEFAULT_PAGE) break;
  }
  if (logged.length !== replayed.length) {
    throw new DeterminismError(`${actorId}: replay produced ${replayed.length} events but the log holds ${logged.length} after seq ${after}`);
  }
  for (let i = 0; i < logged.length; i++) {
    if (comparable(logged[i]!) !== comparable(replayed[i]!)) {
      throw new DeterminismError(`${actorId}: replayed event ${replayed[i]!.seq} (${replayed[i]!.kind}) differs from the logged event ${logged[i]!.seq}`);
    }
  }
}
