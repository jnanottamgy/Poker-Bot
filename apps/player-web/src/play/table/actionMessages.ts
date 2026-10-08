import type { ActionOutcome } from '@jpb/client-sdk';

/**
 * Friendly copy for action_result rejections (codes from
 * packages/shared-types table.ts / hand.ts). Raw server errors are never shown.
 */
const NO_LONGER_VALID = 'Action is no longer valid — the table moved on. Showing the latest state.';

const MESSAGES: Readonly<Record<string, string>> = {
  STALE_STATE_VERSION: NO_LONGER_VALID,
  NOT_YOUR_TURN: NO_LONGER_VALID,
  HAND_NOT_IN_BETTING: NO_LONGER_VALID,
  PLAYER_NOT_IN_HAND: NO_LONGER_VALID,
  PLAYER_FOLDED: NO_LONGER_VALID,
  PLAYER_ALL_IN: NO_LONGER_VALID,
  CHECK_NOT_ALLOWED: NO_LONGER_VALID,
  CALL_NOT_ALLOWED: NO_LONGER_VALID,
  BET_NOT_ALLOWED: NO_LONGER_VALID,
  RAISE_NOT_ALLOWED: NO_LONGER_VALID,
  AMOUNT_REQUIRED: 'Choose an amount first.',
  AMOUNT_NOT_INTEGER: 'Amounts are whole chips only.',
  AMOUNT_BELOW_MINIMUM: 'That amount is below the minimum. Pick a bigger amount.',
  AMOUNT_ABOVE_MAXIMUM: 'That amount is more than you can bet.',
  UNKNOWN_ACTION: NO_LONGER_VALID,
  ACTION_DEADLINE_PASSED: 'Time ran out — the server checked or folded for you.',
  TABLE_FROZEN: 'The table is paused by the tournament director. Your time is preserved.',
  NO_ACTIVE_HAND: 'That hand has already finished.',
  PLAYER_NOT_SEATED: 'You are no longer seated at this table.',
  TABLE_CLOSED: 'This table has closed. You will be moved automatically.',
  RATE_LIMITED: 'Too many taps — please wait a moment.',
  DUPLICATE_ACTION: 'Already received — your action counts once.',
  TIMEOUT: 'No answer from the server yet — showing the latest table state.',
  NOT_CONNECTED: 'You are offline. Your action was not sent.',
  INVALID_COMMAND: 'That action could not be sent. Please try again.',
};

/** Returns null when the action succeeded (or was a harmless duplicate of an accepted one). */
export function actionErrorMessage(outcome: Pick<ActionOutcome, 'ok' | 'code' | 'message'>): string | null {
  if (outcome.ok) return null;
  if (outcome.code && MESSAGES[outcome.code]) {
    // INVALID_COMMAND carries a purpose-written sentence from the gateway (e.g. another device has control).
    if (outcome.code === 'INVALID_COMMAND' && outcome.message && outcome.message.length < 160) return outcome.message;
    return MESSAGES[outcome.code] as string;
  }
  if (outcome.message === 'An action is already being submitted.') return 'Hold on — your previous action is still being submitted.';
  return 'Something went wrong sending your action. Showing the latest table state.';
}
