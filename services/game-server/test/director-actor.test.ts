import { describe, expect, it } from 'vitest';
import { createSeedCommitment } from '@jpb/fairness-engine/node';
import { simulationConfig } from '@jpb/simulation';
import { openTableList } from '@jpb/tournament-engine';
import type { DirectorInput } from '@jpb/tournament-engine';
import { createDirectorActorDefinition } from '../src/game/director-actor';
import type { DirectorActorCommand, DirectorActorState } from '../src/game/director-actor';
import type { StepResult } from '../src/runtime/actor';

/**
 * Johnny's actor step without I/O: table reports coalesced into one REPORTS
 * command (what the outbox dispatcher sends under load) must be exactly
 * equivalent to the same reports applied one by one, and re-delivery must
 * never apply a report twice.
 */
describe('director actor: coalesced table reports', () => {
  const { serverSeed, serverSeedHash } = createSeedCommitment();
  const def = createDirectorActorDefinition({ seedFor: () => serverSeed, snapshotEvery: 1000 });
  const T0 = 1_800_000_000_000;

  function started(players: number) {
    let state: DirectorActorState = def.initialState('trn_batch');
    let seq = 0;
    const run = (s: DirectorActorState, command: DirectorActorCommand, at = T0 + seq * 10): StepResult<DirectorActorState, unknown> => def.step(s, { actorId: 'trn_batch', seq: ++seq, commandId: `c${seq}`, at, command });
    const apply = (command: DirectorActorCommand) => {
      const r = run(state, command);
      if (!r.noop) state = r.state;
      return r;
    };
    apply({ kind: 'CREATE', input: { tournamentId: 'trn_batch', config: simulationConfig(players), createdAt: T0, serverSeedHash } });
    apply({ kind: 'INPUT', input: { type: 'OPEN_REGISTRATION' } });
    for (let i = 0; i < players; i++) {
      apply({ kind: 'INPUT', input: { type: 'REGISTER_PLAYER', playerId: `p${i}`, entryId: `e${i}`, displayName: `P${i}`, publicId: `X${i}`, registrationSeq: i + 1, clientSeed: null, approved: true } });
    }
    expect((apply({ kind: 'INPUT', input: { type: 'START', publicEntropy: 'a'.repeat(64) } }).reply as { ok: boolean }).ok).toBe(true);
    return { state, run };
  }

  /** Status reports for every table, a few per table, rseq increasing per table. */
  function statusReports(state: DirectorActorState) {
    const tables = openTableList(state.director!).map((t) => t.summary.tableId);
    const reports: Array<{ tableId: string; rseq: number; input: DirectorInput }> = [];
    for (let round = 1; round <= 3; round++) {
      for (const tableId of tables) {
        const status = round % 2 ? 'IN_HAND' : 'BETWEEN_HANDS';
        reports.push({ tableId, rseq: round, input: { type: 'TABLE_STATUS_CHANGED', tableId, status, holds: [], frozen: false } });
      }
    }
    return reports;
  }

  it('applies a batch exactly like the same reports one by one', () => {
    const { state, run } = started(30);
    const reports = statusReports(state);
    expect(reports.length).toBeGreaterThan(6);

    let oneByOne = state;
    for (const r of reports) {
      const res = run(oneByOne, { kind: 'REPORT', ...r }, T0 + 5000);
      if (!res.noop) oneByOne = res.state;
    }
    const batched = run(state, { kind: 'REPORTS', reports }, T0 + 5000);
    expect(batched.noop).toBeFalsy();
    expect(batched.state.director).toEqual(oneByOne.director);
    expect(batched.state.eventSeq).toBe(oneByOne.eventSeq);
    expect(batched.state.reportSeqs).toEqual(oneByOne.reportSeqs);
    // At most one net TICK directive per command.
    expect(batched.timers.filter((t) => t.key === 'TICK').length + batched.cancelTimers.filter((k) => k === 'TICK').length).toBeLessThanOrEqual(1);
  });

  it('skips reports already applied when a batch is re-delivered', () => {
    const { state, run } = started(30);
    const reports = statusReports(state);
    const half = Math.floor(reports.length / 2);
    const first = run(state, { kind: 'REPORTS', reports: reports.slice(0, half) }, T0 + 5000);
    const whole = run(first.state, { kind: 'REPORTS', reports }, T0 + 5000);
    const direct = run(state, { kind: 'REPORTS', reports }, T0 + 5000);
    expect(whole.state.director).toEqual(direct.state.director);
    expect(whole.state.reportSeqs).toEqual(direct.state.reportSeqs);

    const again = run(whole.state, { kind: 'REPORTS', reports }, T0 + 6000);
    expect(again.noop).toBe(true);
    expect(again.reply).toMatchObject({ ok: true, duplicate: true });
  });

  it('a rejected report advances its own sequence and the rest of the batch still applies', () => {
    const { state, run } = started(20);
    const good = statusReports(state).slice(0, 2);
    const bad = { tableId: 'trn_batch:T99', rseq: 1, input: { type: 'TABLE_STACK_ADJUSTED', tableId: 'trn_batch:T99', playerId: 'p0', before: 1, after: 2 } as DirectorInput };
    const res = run(state, { kind: 'REPORTS', reports: [good[0]!, bad, good[1]!] }, T0 + 5000);
    expect(res.noop).toBeFalsy();
    expect(res.reply).toMatchObject({ ok: true });
    expect(res.state.reportSeqs).toEqual(run(run(state, { kind: 'REPORTS', reports: good }, T0 + 5000).state, { kind: 'REPORT', ...bad }, T0 + 5000).state.reportSeqs);
    const table = openTableList(res.state.director!).find((t) => t.summary.tableId === good[1]!.tableId)!;
    expect(table.status).toBe('IN_HAND');
  });
});
