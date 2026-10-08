import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ClientMessage } from '@jpb/shared-types';
import { INPUT_LIMITS, clientMessageSchema, parseClientMessage, validateClientMessage } from '../src';

const VALID: ClientMessage[] = [
  { t: 'hello', v: 1, audience: 'PLAYER', tournamentId: 'trn_0123abcd', resume: null },
  { t: 'hello', v: 1, audience: 'ADMIN', tournamentId: 'trn_0123abcd', resume: { tableId: 'trn_0123abcd:T12', tableSeq: 40, tournamentSeq: 7 } },
  { t: 'hello', v: 2, audience: 'DISPLAY', tournamentId: 't1', resume: { tableId: null, tableSeq: 0, tournamentSeq: 0 } },
  { t: 'action', actionId: 'ACT-ABCDEFGHJKMNPQRSTVWX', tableId: 'trn_1:T3', type: 'CALL', tableStateVersion: 5 },
  { t: 'action', actionId: 'ACT-ABCDEFGHJKMNPQRSTVWX', tableId: 'trn_1:T3', type: 'RAISE', amount: 999_999_999, tableStateVersion: 5 },
  { t: 'takeover' },
  { t: 'ping', ct: 1_700_000_000_123 },
  { t: 'ping', ct: 1_700_000_000_123.25 },
  { t: 'watch', tableId: 'trn_1:T3' },
  { t: 'watch', tableId: null },
  { t: 'snapshot_request' },
];

describe('client messages', () => {
  it.each(VALID.map((m) => [m.t, m] as const))('accepts a valid %s frame', (_t, message) => {
    const result = parseClientMessage(JSON.stringify(message));
    expect(result).toEqual({ ok: true, message });
  });

  it.each([
    ['unknown type', { t: 'chat', text: 'hi' }, 'UNKNOWN_TYPE'],
    ['missing type', { actionId: 'x' }, 'UNKNOWN_TYPE'],
    ['non-string type', { t: 5 }, 'UNKNOWN_TYPE'],
    ['array frame', [{ t: 'ping', ct: 1 }], 'UNKNOWN_TYPE'],
    ['null frame', null, 'UNKNOWN_TYPE'],
    ['prototype key as type', { t: 'constructor' }, 'UNKNOWN_TYPE'],
    ['extra key (smuggled seat)', { t: 'action', actionId: 'ACT-12345678', tableId: 'T1', type: 'FOLD', tableStateVersion: 1, seat: 2 }, 'INVALID_MESSAGE'],
    ['fractional amount', { t: 'action', actionId: 'ACT-12345678', tableId: 'T1', type: 'BET', amount: 10.5, tableStateVersion: 1 }, 'INVALID_MESSAGE'],
    ['negative amount', { t: 'action', actionId: 'ACT-12345678', tableId: 'T1', type: 'BET', amount: -10, tableStateVersion: 1 }, 'INVALID_MESSAGE'],
    ['string amount', { t: 'action', actionId: 'ACT-12345678', tableId: 'T1', type: 'BET', amount: '10', tableStateVersion: 1 }, 'INVALID_MESSAGE'],
    ['short action id', { t: 'action', actionId: 'A1', tableId: 'T1', type: 'FOLD', tableStateVersion: 1 }, 'INVALID_MESSAGE'],
    ['bad table id', { t: 'action', actionId: 'ACT-12345678', tableId: '../etc', type: 'FOLD', tableStateVersion: 1 }, 'INVALID_MESSAGE'],
    ['missing tableStateVersion', { t: 'action', actionId: 'ACT-12345678', tableId: 'T1', type: 'FOLD' }, 'INVALID_MESSAGE'],
    ['bad audience', { t: 'hello', v: 1, audience: 'GOD', tournamentId: 't1', resume: null }, 'INVALID_MESSAGE'],
    ['protocol version 0', { t: 'hello', v: 0, audience: 'PLAYER', tournamentId: 't1', resume: null }, 'INVALID_MESSAGE'],
    ['missing resume', { t: 'hello', v: 1, audience: 'PLAYER', tournamentId: 't1' }, 'INVALID_MESSAGE'],
    ['negative resume seq', { t: 'hello', v: 1, audience: 'PLAYER', tournamentId: 't1', resume: { tableId: null, tableSeq: -1, tournamentSeq: 0 } }, 'INVALID_MESSAGE'],
    ['too long id', { t: 'watch', tableId: 'T'.repeat(INPUT_LIMITS.ID_MAX_LENGTH + 1) }, 'INVALID_MESSAGE'],
    ['ping without ct', { t: 'ping' }, 'INVALID_MESSAGE'],
    ['ping with NaN-ish ct', { t: 'ping', ct: -5 }, 'INVALID_MESSAGE'],
    ['takeover with payload', { t: 'takeover', force: true }, 'INVALID_MESSAGE'],
  ])('rejects %s', (_name, frame, code) => {
    const result = parseClientMessage(JSON.stringify(frame));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('reports the offending field for invalid frames', () => {
    const result = parseClientMessage(JSON.stringify({ t: 'action', actionId: 'ACT-12345678', tableId: 'T1', type: 'BET', amount: 10.5, tableStateVersion: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.issues.map((i) => i.path)).toEqual(['amount']);
      expect(result.message).toBe('Invalid "action" message: Amount: Must be a whole number.');
    }
  });

  it('rejects malformed JSON', () => {
    for (const raw of ['', '{', '{"t":"ping",}', 'undefined', "{'t':'ping'}", 'NaN']) {
      const result = parseClientMessage(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('MALFORMED_JSON');
    }
  });

  it('enforces the frame size limit in UTF-8 bytes', () => {
    const pad = (n: number) => JSON.stringify({ t: 'watch', tableId: null, x: 'a'.repeat(n) });
    const limit = 100;
    const exact = pad(limit - pad(0).length);
    expect(exact.length).toBe(limit);
    const atLimit = parseClientMessage(exact, { maxBytes: limit });
    expect(atLimit.ok === false && atLimit.code).toBe('INVALID_MESSAGE'); // passes the size gate, fails the schema (extra key)
    const over = parseClientMessage(pad(limit - pad(0).length + 1), { maxBytes: limit });
    expect(over.ok === false && over.code).toBe('FRAME_TOO_LARGE');
    // multi-byte characters count by bytes, not UTF-16 units
    const multi = JSON.stringify({ t: 'watch', tableId: null, x: '名'.repeat(30) });
    expect(multi.length).toBeLessThan(limit);
    const tooBig = parseClientMessage(multi, { maxBytes: limit });
    expect(tooBig.ok === false && tooBig.code).toBe('FRAME_TOO_LARGE');
    // default limit
    const huge = parseClientMessage(JSON.stringify({ t: 'ping', ct: 1, pad: 'x'.repeat(INPUT_LIMITS.CLIENT_MESSAGE_MAX_BYTES) }));
    expect(huge.ok === false && huge.code).toBe('FRAME_TOO_LARGE');
  });

  it('validateClientMessage accepts decoded values', () => {
    expect(validateClientMessage({ t: 'snapshot_request' })).toEqual({ ok: true, message: { t: 'snapshot_request' } });
    expect(validateClientMessage(undefined).ok).toBe(false);
  });

  it('never throws on arbitrary strings or values (property)', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (raw) => void parseClientMessage(raw)), { numRuns: 1000 });
    fc.assert(fc.property(fc.jsonValue(), (v) => void parseClientMessage(JSON.stringify(v) ?? 'null')), { numRuns: 1000 });
    fc.assert(fc.property(fc.anything(), (v) => void validateClientMessage(v)), { numRuns: 1000 });
  });

  it('every accepted frame re-validates identically (property)', () => {
    const frame = fc.record(
      {
        t: fc.constantFrom('hello', 'action', 'takeover', 'ping', 'watch', 'snapshot_request'),
        v: fc.oneof(fc.integer(), fc.anything()),
        audience: fc.constantFrom('PLAYER', 'SPECTATOR', 'ADMIN', 'DISPLAY', 'X'),
        tournamentId: fc.oneof(fc.stringMatching(/^[a-z0-9_:]{1,10}$/), fc.anything()),
        resume: fc.oneof(fc.constant(null), fc.anything()),
        actionId: fc.oneof(fc.stringMatching(/^[A-Za-z0-9_-]{8,12}$/), fc.string()),
        tableId: fc.oneof(fc.constant(null), fc.stringMatching(/^[A-Za-z0-9:]{1,10}$/)),
        type: fc.constantFrom('FOLD', 'CHECK', 'BET', 'nope'),
        amount: fc.oneof(fc.nat(), fc.double()),
        tableStateVersion: fc.oneof(fc.nat(), fc.double()),
        ct: fc.oneof(fc.nat(), fc.double()),
      },
      { requiredKeys: ['t'] },
    );
    fc.assert(
      fc.property(frame, (data) => {
        const result = validateClientMessage(data);
        if (result.ok) expect(clientMessageSchema.parse(result.message)).toEqual(result.message);
      }),
      { numRuns: 2000 },
    );
  });
});
