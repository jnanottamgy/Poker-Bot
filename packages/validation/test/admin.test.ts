import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DANGEROUS_OPERATIONS } from '@jpb/shared-types';
import type { DangerousOperation } from '@jpb/shared-types';
import {
  DANGEROUS_OPERATION_CONFIRM_WORDS,
  DANGEROUS_OPERATION_SCHEMAS,
  adminAddTimeSchema,
  adminAnnounceSchema,
  adminCreateTournamentSchema,
  adminForceTimeoutSchema,
  adminHandForHandSchema,
  adminMovePlayerSchema,
  adminOverrideSchema,
  adminPaymentUpdateSchema,
  adminPlayerNoticeSchema,
  adminReasonSchema,
  adminRunningConfigEditSchema,
  adminSimpleActionSchema,
  adminStartBreakSchema,
  adminStartTournamentSchema,
  adminUpdateConfigSchema,
  defaultTournamentConfig,
  demoRequestSchema,
  validateAdminOverride,
  validateWith,
} from '../src';
import { expectIssue, expectOk } from './fixtures';

const PAYLOADS: Record<DangerousOperation, Record<string, unknown>> = {
  CANCEL_TOURNAMENT: {},
  FORCE_ELIMINATE: {},
  DISQUALIFY_PLAYER: {},
  SET_BLIND_LEVEL: { level: 7 },
  RESTORE_PLAYER: {},
  ADJUST_STACK: { newStack: 12_500 },
  EMERGENCY_FREEZE: {},
  BREAK_TABLE: {},
  REVEAL_SEED: {},
};

function body(op: DangerousOperation, extra: Record<string, unknown> = {}) {
  return { ...PAYLOADS[op], reason: 'Dealer error at table 12', confirm: DANGEROUS_OPERATION_CONFIRM_WORDS[op], ...extra };
}

describe('dangerous operations', () => {
  it('every DangerousOperation has a confirmation word and a schema', () => {
    for (const op of DANGEROUS_OPERATIONS) {
      expect(DANGEROUS_OPERATION_CONFIRM_WORDS[op]).toMatch(/^[A-Z]+$/);
      expect(DANGEROUS_OPERATION_SCHEMAS[op]).toBeDefined();
    }
  });

  it.each([...DANGEROUS_OPERATIONS])('%s accepts a complete body and returns the sanitized reason', (op) => {
    const value = expectOk(validateAdminOverride(op, body(op, { reason: '  Dealer\u200B error  ' })));
    expect(value.reason).toBe('Dealer error');
    expect(value.confirm).toBe(DANGEROUS_OPERATION_CONFIRM_WORDS[op]);
  });

  it.each([...DANGEROUS_OPERATIONS])('%s requires a reason of at least 3 characters', (op) => {
    for (const reason of [undefined, null, '', '  ', 'ok', '\u200B\u200Bab', 42]) {
      expectIssue(validateAdminOverride(op, body(op, { reason })), 'reason', 'reason');
    }
    expect(validateAdminOverride(op, body(op, { reason: 'abc' })).ok).toBe(true);
  });

  it.each([...DANGEROUS_OPERATIONS])('%s requires the exact confirmation word', (op) => {
    const word = DANGEROUS_OPERATION_CONFIRM_WORDS[op];
    for (const confirm of [undefined, '', word.toLowerCase(), `${word} `, 'YES', true]) {
      expectIssue(validateAdminOverride(op, body(op, { confirm })), 'confirm', `Type ${word}`);
    }
  });

  it('rejects unknown keys and validates payloads', () => {
    expectIssue(validateAdminOverride('CANCEL_TOURNAMENT', body('CANCEL_TOURNAMENT', { refundAll: true })), '', 'Unknown field');
    expectIssue(validateAdminOverride('SET_BLIND_LEVEL', body('SET_BLIND_LEVEL', { level: 0 })), 'level');
    expectIssue(validateAdminOverride('SET_BLIND_LEVEL', body('SET_BLIND_LEVEL', { level: 2.5 })), 'level');
    expectIssue(validateAdminOverride('ADJUST_STACK', body('ADJUST_STACK', { newStack: -1 })), 'newStack');
    expectIssue(validateAdminOverride('ADJUST_STACK', body('ADJUST_STACK', { newStack: '100' })), 'newStack');
    expect(validateAdminOverride('ADJUST_STACK', body('ADJUST_STACK', { newStack: 0 })).ok).toBe(true);
  });

  it('caps the reason length', () => {
    expectIssue(validateAdminOverride('REVEAL_SEED', body('REVEAL_SEED', { reason: 'r'.repeat(501) })), 'reason', 'at most 500');
    expectIssue(validateAdminOverride('REVEAL_SEED', body('REVEAL_SEED', { reason: 'r'.repeat(100_000) })), 'reason', 'at most 500');
    expect(validateAdminOverride('REVEAL_SEED', body('REVEAL_SEED', { reason: 'r'.repeat(500) })).ok).toBe(true);
  });

  it('rejects an unknown operation name without throwing', () => {
    expect(validateAdminOverride('DROP_DATABASE' as DangerousOperation, {}).ok).toBe(false);
  });

  it('adminOverrideSchema builds schemas with custom payloads', () => {
    const schema = adminOverrideSchema('FORCE_ELIMINATE', { finishPosition: adminReasonSchema.optional() });
    expect(schema.safeParse({ reason: 'abc', confirm: 'ELIMINATE' }).success).toBe(true);
    expect(schema.safeParse({ reason: 'abc', confirm: 'CANCEL' }).success).toBe(false);
  });

  it('never throws (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DANGEROUS_OPERATIONS), fc.anything(), (op, input) => {
        const result = validateAdminOverride(op, input);
        if (result.ok) expect(result.value.reason.length).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('level 0/1 admin bodies', () => {
  it('simple actions take an optional reason and an optional body', () => {
    expect(expectOk(validateWith(adminSimpleActionSchema, undefined))).toEqual({ reason: null });
    expect(expectOk(validateWith(adminSimpleActionSchema, {}))).toEqual({ reason: null });
    expect(expectOk(validateWith(adminSimpleActionSchema, { reason: '  ' }))).toEqual({ reason: null });
    expect(expectOk(validateWith(adminSimpleActionSchema, { reason: ' Lunch ' }))).toEqual({ reason: 'Lunch' });
    expectIssue(validateWith(adminSimpleActionSchema, { reason: 'ab' }), 'reason');
    expectIssue(validateWith(adminSimpleActionSchema, { reason: 'Lunch', x: 1 }), '');
  });

  it('add-time: non-zero whole ms within a day either way', () => {
    expect(validateWith(adminAddTimeSchema, { ms: -60_000 }).ok).toBe(true);
    expect(validateWith(adminAddTimeSchema, { ms: 86_400_000, reason: 'Extended level' }).ok).toBe(true);
    expectIssue(validateWith(adminAddTimeSchema, { ms: 0 }), 'ms', 'at least 1 millisecond');
    expectIssue(validateWith(adminAddTimeSchema, { ms: 86_400_001 }), 'ms');
    expectIssue(validateWith(adminAddTimeSchema, { ms: 1.5 }), 'ms');
  });

  it('break start, hand-for-hand, force timeout', () => {
    expect(validateWith(adminStartBreakSchema, { durationSeconds: 600 }).ok).toBe(true);
    expectIssue(validateWith(adminStartBreakSchema, { durationSeconds: 0 }), 'durationSeconds');
    expect(validateWith(adminHandForHandSchema, { enabled: true }).ok).toBe(true);
    expectIssue(validateWith(adminHandForHandSchema, { enabled: 'yes' }), 'enabled');
    expectIssue(validateWith(adminForceTimeoutSchema, {}), 'reason', 'reason');
    expect(validateWith(adminForceTimeoutSchema, { reason: 'Player left the venue' }).ok).toBe(true);
  });

  it('move player requires a reason and a valid seat', () => {
    expect(validateWith(adminMovePlayerSchema, { toTableId: 'trn_1:T4', toSeat: 3, reason: 'Accessibility' }).ok).toBe(true);
    expect(validateWith(adminMovePlayerSchema, { toTableId: 'trn_1:T4', reason: 'Accessibility' }).ok).toBe(true);
    expectIssue(validateWith(adminMovePlayerSchema, { toTableId: 'trn_1:T4', toSeat: 10, reason: 'Accessibility' }), 'toSeat');
    expectIssue(validateWith(adminMovePlayerSchema, { toTableId: 'trn_1:T4' }), 'reason');
    expectIssue(validateWith(adminMovePlayerSchema, { toTableId: '<T4>', reason: 'abc' }), 'toTableId');
  });

  it('announcements need a target exactly for TABLE and PLAYER scopes', () => {
    expect(expectOk(validateWith(adminAnnounceSchema, { text: ' Final table in 5 < minutes ', scope: 'ALL' }))).toEqual({
      text: 'Final table in 5 < minutes',
      scope: 'ALL',
      targetId: null,
    });
    expect(validateWith(adminAnnounceSchema, { text: 'Seat change', scope: 'TABLE', targetId: 'trn_1:T4' }).ok).toBe(true);
    expectIssue(validateWith(adminAnnounceSchema, { text: 'Seat change', scope: 'PLAYER' }), 'targetId', 'player');
    expectIssue(validateWith(adminAnnounceSchema, { text: 'Hello', scope: 'DISPLAY', targetId: 'x1' }), 'targetId', 'no target');
    expectIssue(validateWith(adminAnnounceSchema, { text: '', scope: 'ALL' }), 'text');
    expectIssue(validateWith(adminAnnounceSchema, { text: 'x'.repeat(281), scope: 'ALL' }), 'text');
    expectIssue(validateWith(adminAnnounceSchema, { text: 'Hi', scope: 'EVERYONE' }), 'scope');
    expect(validateWith(adminPlayerNoticeSchema, { text: 'Please return to your seat' }).ok).toBe(true);
  });

  it('payment updates normalize optional text', () => {
    expect(expectOk(validateWith(adminPaymentUpdateSchema, { status: 'PAID', reference: ' UPI-123 ', note: '' }))).toEqual({
      status: 'PAID',
      reference: 'UPI-123',
      note: null,
    });
    expect(expectOk(validateWith(adminPaymentUpdateSchema, { status: 'UNPAID' }))).toEqual({ status: 'UNPAID', reference: null, note: null });
    expectIssue(validateWith(adminPaymentUpdateSchema, { status: 'REFUNDED' }), 'status');
    expectIssue(validateWith(adminPaymentUpdateSchema, { status: 'PAID', reference: 'r'.repeat(121) }), 'reference');
  });

  it('start accepts optional printable admin entropy', () => {
    expect(expectOk(validateWith(adminStartTournamentSchema, undefined))).toEqual({ adminEntropy: null });
    expect(expectOk(validateWith(adminStartTournamentSchema, { adminEntropy: 'dice: 3 5 1 6' }))).toEqual({ adminEntropy: 'dice: 3 5 1 6' });
    expect(expectOk(validateWith(adminStartTournamentSchema, { adminEntropy: '  ' }))).toEqual({ adminEntropy: null });
    expectIssue(validateWith(adminStartTournamentSchema, { adminEntropy: 'ünïcode' }), 'adminEntropy');
    expectIssue(validateWith(adminStartTournamentSchema, { adminEntropy: 'x'.repeat(257) }), 'adminEntropy');
  });

  it('config create/update/running-edit bodies', () => {
    const config = defaultTournamentConfig();
    expect(validateWith(adminCreateTournamentSchema, { config }).ok).toBe(true);
    expectIssue(validateWith(adminCreateTournamentSchema, { config: { ...config, startingStack: 0 } }), 'config.startingStack');
    expect(validateWith(adminUpdateConfigSchema, { config, reason: 'Fix typo in name' }).ok).toBe(true);
    expect(validateWith(adminRunningConfigEditSchema, { config, reason: 'Slow down levels', confirm: 'EDIT' }).ok).toBe(true);
    expectIssue(validateWith(adminRunningConfigEditSchema, { config, reason: 'Slow down levels', confirm: 'edit' }), 'confirm');
  });

  it('demo requests need players in range and one positive strategy weight', () => {
    expect(validateWith(demoRequestSchema, { players: 500, strategyMix: { CALL_HEAVY: 2, ALWAYS_FOLD: 0 }, speedMode: true }).ok).toBe(true);
    expectIssue(validateWith(demoRequestSchema, { players: 500, strategyMix: { ALWAYS_FOLD: 0 }, speedMode: true }), 'strategyMix', 'positive');
    expectIssue(validateWith(demoRequestSchema, { players: 1, strategyMix: { FLAKY: 1 }, speedMode: false }), 'players');
    expectIssue(validateWith(demoRequestSchema, { players: 10, strategyMix: { GTO_SOLVER: 1 }, speedMode: false }), 'strategyMix');
    expectIssue(validateWith(demoRequestSchema, { players: 10, strategyMix: { FLAKY: -1 }, speedMode: false }), 'strategyMix.FLAKY');
  });
});
