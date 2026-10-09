import { describe, expect, it } from 'vitest';
import { ApiError, INITIAL_STATE } from '@jpb/client-sdk';
import type { GameState } from '@jpb/client-sdk';
import type { JoinInfoDto, PlayerNotice, PlayerSelfSummary, TournamentPublicSummary } from '@jpb/shared-types';
import { friendlyError } from '../src/api/errors';
import { normalizePublicId, parseRejoinFragment } from '../src/join/rejoinFragment';
import { deriveScreen } from '../src/play/deriveScreen';
import { isBlockingNotice, supersededNotices } from '../src/play/notices/NoticeLayer';
import { reentryOffer } from '../src/play/reentry';

const self = (over: Partial<PlayerSelfSummary> = {}): PlayerSelfSummary => ({
  playerId: 'ply_1',
  publicId: 'JPN-7A42',
  displayName: 'Ada',
  status: 'SEATED',
  tableId: 'T1',
  tableNumber: 1,
  seat: 0,
  stack: 10_000,
  finishPosition: null,
  prizeMinor: 0,
  handsPlayed: 3,
  ...over,
});

const summary = (over: Partial<TournamentPublicSummary> = {}): TournamentPublicSummary => ({
  tournamentId: 'trn_1',
  name: 'Cup',
  status: 'RUNNING',
  clock: { level: 2, levelStartedAt: 0, levelEndsAt: 1, pausedRemainingMs: null, breakEndsAt: null } as unknown as TournamentPublicSummary['clock'],
  currentLevel: { level: 2, smallBlind: 100, bigBlind: 200, ante: 0, durationSeconds: 600 } as TournamentPublicSummary['currentLevel'],
  nextLevel: null,
  counters: { registered: 10, active: 8, eliminated: 2, inTransit: 0, tables: 1, handsCompleted: 5, totalChips: 100_000, largestPot: 0 },
  handForHand: false,
  lastSeq: 9,
  serverSeedHash: 'ab',
  ...over,
});

const state = (over: Partial<GameState>): GameState => ({ ...INITIAL_STATE, connection: 'open', synced: true, ...over });

describe('server error codes → player copy', () => {
  it('maps the real registration / rejoin codes and per-field details', () => {
    const fields = friendlyError(new ApiError(400, 'INVALID_FIELDS', 'Please check the highlighted fields.', [{ field: 'email', message: 'Enter a valid email address.' }]));
    expect(fields.title).toBe('Please check the form');
    expect(fields.fields).toEqual({ email: 'Enter a valid email address.' });
    const zod = friendlyError(new ApiError(400, 'INVALID_INPUT', 'Some fields are invalid.', [{ path: 'fields.name', message: 'Required' }]));
    expect(zod.fields).toEqual({ name: 'Required' });
    expect(friendlyError(new ApiError(401, 'REJOIN_FAILED', 'x')).title).toBe('Could not rejoin');
    expect(friendlyError(new ApiError(403, 'ACCESS_CODE', 'That access code is not correct.')).title).toBe('Access code not accepted');
    expect(friendlyError(new ApiError(409, 'REENTRY_CLOSED', 'Re-entry is closed.')).title).toBe('Re-entry is closed');
    expect(friendlyError(new ApiError(429, 'RATE_LIMITED', 'slow')).code).toBe('RATE_LIMITED');
  });
});

describe('screens from server state', () => {
  it('a revoked session ends in the rejoin screen instead of reconnecting forever', () => {
    expect(deriveScreen(state({ lastError: { code: 'SESSION_REVOKED', message: 'x' }, self: self(), tournament: summary() }), { spectate: false })).toBe('session-expired');
  });

  it('busted players see the result once the tournament is over', () => {
    const s = state({ self: self({ status: 'ELIMINATED', tableId: null }), tournament: summary({ status: 'COMPLETED' }) });
    expect(deriveScreen(s, { spectate: true })).toBe('completed');
    expect(deriveScreen({ ...s, tournament: summary() }, { spectate: false })).toBe('eliminated');
  });
});

describe('notices', () => {
  const seat: PlayerNotice = { kind: 'TABLE_MOVE', fromTableNumber: null, fromSeat: null, toTableNumber: 1, toSeat: 2, stack: 10_000 };
  const move: PlayerNotice = { kind: 'TABLE_MOVE', fromTableNumber: 1, fromSeat: 2, toTableNumber: 3, toSeat: 4, stack: 9_000 };
  const out: PlayerNotice = { kind: 'ELIMINATED', finishPosition: 7, tiedCount: 1, handsPlayed: 12, prizeMinor: 0, currency: 'INR' };
  const message: PlayerNotice = { kind: 'MESSAGE', text: 'See the desk', from: 'ADMIN' };

  it('staff messages never take over the screen', () => {
    expect(isBlockingNotice(message)).toBe(false);
    expect(isBlockingNotice({ kind: 'RESTORED' })).toBe(false);
    expect(isBlockingNotice(move)).toBe(true);
  });

  it('an unacknowledged seat card is dropped once a later move or elimination arrives', () => {
    expect(supersededNotices([seat, message, move])).toEqual([seat]);
    expect(supersededNotices([seat, out])).toEqual([seat]);
    expect(supersededNotices([seat, message])).toEqual([]);
  });
});

describe('re-entry offer', () => {
  const info = (reentry: unknown) => ({ registration: { reentry } }) as unknown as JoinInfoDto;

  it('needs an eliminated player and server data saying re-entry is open', () => {
    const busted = self({ status: 'ELIMINATED', tableId: null });
    expect(reentryOffer(busted, summary(), null)).toBeNull();
    expect(reentryOffer(self(), summary(), info({ enabled: true, maxEntriesPerPlayer: 2, untilLevel: 4 }))).toBeNull();
    expect(reentryOffer(busted, summary(), info({ enabled: true, maxEntriesPerPlayer: 2, untilLevel: 4 }))).toEqual({ untilLevel: 4, entriesLeft: null });
    expect(reentryOffer(busted, summary(), info({ enabled: true, maxEntriesPerPlayer: 2, untilLevel: 1 }))).toBeNull();
    expect(reentryOffer(busted, summary({ status: 'FINAL_TABLE' }), info({ enabled: true, maxEntriesPerPlayer: 2, untilLevel: 4 }))).toBeNull();
  });

  it('an explicit server decision on the self summary wins', () => {
    const withFlag = (reentry: unknown) => ({ ...self({ status: 'ELIMINATED', tableId: null }), reentry }) as unknown as PlayerSelfSummary;
    expect(reentryOffer(withFlag({ available: false }), summary(), info({ enabled: true, maxEntriesPerPlayer: 2, untilLevel: 4 }))).toBeNull();
    expect(reentryOffer(withFlag({ available: true, entriesUsed: 1, maxEntries: 3, untilLevel: 6 }), summary(), null)).toEqual({ untilLevel: 6, entriesLeft: 2 });
  });
});

describe('player ID input', () => {
  it('accepts lower case, a missing dash and look-alike letters', () => {
    expect(normalizePublicId(' jpn7a42 ')).toBe('JPN-7A42');
    expect(normalizePublicId('JPN-OIL5')).toBe('JPN-0115');
    expect(parseRejoinFragment('#rejoin=jpn-7a42:7kqm-2xwd')).toEqual({ publicId: 'JPN-7A42', rejoinCode: '7KQM-2XWD' });
  });
});
