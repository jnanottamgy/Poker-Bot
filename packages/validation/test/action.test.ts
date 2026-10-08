import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PlayerActionRequest } from '@jpb/shared-types';
import { ACTION_TYPES, playerActionRequestSchema, validatePlayerActionRequest } from '../src';
import { expectIssue, expectOk } from './fixtures';

const base: PlayerActionRequest = { actionId: 'ACT-0123456789ABCDEFGHJK', type: 'RAISE', amount: 600, tableStateVersion: 12 };

describe('player action request', () => {
  it('accepts every action type, with and without an amount', () => {
    for (const type of ACTION_TYPES) {
      expect(validatePlayerActionRequest({ ...base, type }).ok, type).toBe(true);
      const { amount: _a, ...noAmount } = base;
      expect(validatePlayerActionRequest({ ...noAmount, type }).ok, type).toBe(true);
    }
  });

  it('returns the request unchanged', () => {
    expect(expectOk(validatePlayerActionRequest(base))).toEqual(base);
  });

  it('accepts 999999999 (syntactically valid; the engine checks the range)', () => {
    expect(expectOk(validatePlayerActionRequest({ ...base, amount: 999_999_999 })).amount).toBe(999_999_999);
    expect(validatePlayerActionRequest({ ...base, amount: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
    expect(validatePlayerActionRequest({ ...base, amount: 0 }).ok).toBe(true);
  });

  it.each([
    ['NaN', Number.NaN, 'finite'],
    ['Infinity', Number.POSITIVE_INFINITY, 'finite'],
    ['-Infinity', Number.NEGATIVE_INFINITY, 'finite'],
    ['negative', -1, 'at least 0'],
    ['fractional', 100.5, 'whole number'],
    ['tiny fraction', 1e-9, 'whole number'],
    ['unsafe integer', 2 ** 53, 'at most'],
    ['numeric string', '600', 'number'],
    ['empty string', '', 'number'],
    ['null', null, 'number'],
    ['boolean', true, 'number'],
    ['array', [600], 'number'],
    ['object', { value: 600 }, 'number'],
  ])('rejects amount %s', (_name, amount, text) => {
    expectIssue(validatePlayerActionRequest({ ...base, amount }), 'amount', text);
  });

  it('rejects malformed action ids', () => {
    for (const actionId of ['short', 'a'.repeat(65), 'has space123', 'semi;colon1', 'ACT:12345678', 'ACT.12345678', '', 12345678, null]) {
      expectIssue(validatePlayerActionRequest({ ...base, actionId }), 'actionId');
    }
    for (const actionId of ['a'.repeat(8), 'A'.repeat(64), 'abc_DEF-123']) expect(validatePlayerActionRequest({ ...base, actionId }).ok).toBe(true);
  });

  it('rejects unknown action types (forced bets cannot be sent by clients)', () => {
    for (const type of ['POST_SB', 'POST_BB', 'POST_ANTE', 'fold', 'Raise', 'SIT_OUT', '', 1, null]) {
      expectIssue(validatePlayerActionRequest({ ...base, type }), 'type');
    }
  });

  it('validates tableStateVersion', () => {
    for (const tableStateVersion of [-1, 1.5, '12', Number.NaN, null, undefined]) {
      expectIssue(validatePlayerActionRequest({ ...base, tableStateVersion }), 'tableStateVersion');
    }
    expect(validatePlayerActionRequest({ ...base, tableStateVersion: 0 }).ok).toBe(true);
  });

  it('rejects unknown keys and non-object bodies', () => {
    expectIssue(validatePlayerActionRequest({ ...base, seat: 3 }), '', 'Unknown field');
    expectIssue(validatePlayerActionRequest({ ...base, playerId: 'p1' }), '', 'playerId');
    for (const body of [null, undefined, 'FOLD', 42, [base]]) expect(validatePlayerActionRequest(body).ok).toBe(false);
  });

  it('never throws and accepts only well-formed requests (property)', () => {
    fc.assert(
      fc.property(
        fc.record({ actionId: fc.anything(), type: fc.anything(), amount: fc.anything(), tableStateVersion: fc.anything() }, { requiredKeys: [] }),
        (input) => {
          const result = validatePlayerActionRequest(input);
          if (result.ok) {
            expect(playerActionRequestSchema.safeParse(result.value).success).toBe(true);
            expect(result.value.amount === undefined || Number.isSafeInteger(result.value.amount)).toBe(true);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('accepts every well-formed request (property)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
        fc.constantFrom(...ACTION_TYPES),
        fc.option(fc.maxSafeNat(), { nil: undefined }),
        fc.maxSafeNat(),
        (actionId, type, amount, tableStateVersion) => {
          const req = amount === undefined ? { actionId, type, tableStateVersion } : { actionId, type, amount, tableStateVersion };
          expect(validatePlayerActionRequest(req).ok).toBe(true);
        },
      ),
    );
  });
});
