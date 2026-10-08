import type { LoggedEvent } from '../persistence/repos/logs';
import { canonicalJson } from '../util/canonical-json';
import type { ActorDefinition, ActorEvent } from './actor';
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

export interface RecoveryOptions {
  /** Start from the latest snapshot (default true). False replays the whole log. */
  useSnapshot?: boolean;
  /** Compare replayed events with the logged events (determinism check). */
  verify?: boolean;
  pageSize?: number;
}

const DEFAULT_PAGE = 1000;

export async function recoverActor<S, C, R, M>(
  def: ActorDefinition<S, C, R, M>,
  log: ActorLog<M>,
  actorId: string,
  opts: RecoveryOptions = {},
): Promise<RecoveredActor<S>> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE;
  const snap = opts.useSnapshot === false ? null : await log.latestSnapshot(actorId);
  let state: S = snap ? (def.fromSnapshot ? def.fromSnapshot(snap.state) : (snap.state as S)) : def.initialState(actorId);
  let seq = snap?.commandSeq ?? 0;
  let lastAt = snap?.at ?? 0;
  const snapshotSeq = seq;
  const verify = opts.verify === true && typeof log.eventsAfter === 'function';
  const replayed: ActorEvent[] = [];
  let replayedEvents = 0;
  let replayedCommands = 0;

  for (;;) {
    const page = await log.commandsAfter(actorId, seq, pageSize);
    for (const cmd of page) {
      if (cmd.seq !== seq + 1) throw new DeterminismError(`${actorId}: command log gap (expected seq ${seq + 1}, found ${cmd.seq})`);
      let result;
      try {
        result = def.step(state, { actorId, seq: cmd.seq, commandId: cmd.commandId, at: cmd.at, command: cmd.command as C });
      } catch (err) {
        throw new ReplayStepError(cmd.seq, err);
      }
      if (result.noop) throw new DeterminismError(`${actorId}: logged command ${cmd.seq} (${cmd.type}) replayed as a noop`);
      state = result.state;
      seq = cmd.seq;
      lastAt = cmd.at;
      replayedCommands++;
      replayedEvents += result.events.length;
      if (verify) replayed.push(...result.events);
    }
    if (page.length < pageSize) break;
  }

  if (verify) await verifyEvents(def, log, actorId, state, replayed);
  return { state, seq, lastAt, report: { snapshotSeq, replayedCommands, replayedEvents, seq, verified: verify } };
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
