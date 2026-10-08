/**
 * Pure helpers behind <ActionPanel>. The panel never decides legality: every
 * button is derived from the server's LegalActions, and every amount is
 * clamped to [minTo, maxTo] before it is sent. The server re-validates.
 */
import type { ActionType, LegalActions, PlayerActionIntent } from '@jpb/shared-types';
import { formatChips } from './format';

export type AggressiveKind = 'BET' | 'RAISE';

/** BET when nobody has bet this street, RAISE when facing a bet; null when neither is legal. */
export function aggressiveKind(legal: LegalActions): AggressiveKind | null {
  if (legal.canRaise) return 'RAISE';
  if (legal.canBet) return 'BET';
  return null;
}

/**
 * True when a sized bet/raise is meaningful (there is a range to choose from).
 * When minTo >= maxTo the only aggressive option is all-in, so the panel shows
 * a single ALL-IN button instead of a sizer.
 */
export function canSize(legal: LegalActions): boolean {
  return aggressiveKind(legal) !== null && legal.minTo < legal.maxTo;
}

/** The all-in total the player would reach (street contribution). */
export function allInTotal(legal: LegalActions): number {
  return legal.allInTo > 0 ? legal.allInTo : legal.maxTo;
}

/** Calling puts the player all-in (the call amount is already capped at the stack). */
export function isCallAllIn(legal: LegalActions): boolean {
  return legal.canCall && legal.callAmount > 0 && legal.callAmount >= legal.stack;
}

/** Clamp a "to" amount into the legal range, as an integer. */
export function clampTo(amount: number, legal: LegalActions): number {
  const n = Number.isFinite(amount) ? Math.round(amount) : legal.minTo;
  return Math.min(legal.maxTo, Math.max(legal.minTo, n));
}

export type PresetId = 'min' | '2x' | '2.5x' | '3x' | 'allin';

export interface RaisePreset {
  id: PresetId;
  label: string;
  /** Clamped "to" total. */
  to: number;
  /** The unclamped target fell outside [minTo, maxTo] and was clamped. */
  clamped: boolean;
}

/**
 * PRESET FORMULA (documented, tested):
 *
 *   base = currentBet > 0 ? currentBet : bigBlind
 *   Min    = minTo
 *   2x     = clamp(round(2   * base))
 *   2.5x   = clamp(round(2.5 * base))
 *   3x     = clamp(round(3   * base))
 *   All-in = maxTo
 *
 * where clamp(x) = min(maxTo, max(minTo, x)). Facing a bet the multipliers are
 * "raise to N times the current bet"; unopened they are "bet N big blinds".
 */
export function raisePresets(legal: LegalActions, bigBlind: number): RaisePreset[] {
  const base = legal.currentBet > 0 ? legal.currentBet : Math.max(1, bigBlind);
  const mult = (id: PresetId, label: string, m: number): RaisePreset => {
    const raw = Math.round(m * base);
    const to = clampTo(raw, legal);
    return { id, label, to, clamped: to !== raw };
  };
  return [
    { id: 'min', label: 'Min', to: legal.minTo, clamped: false },
    mult('2x', '2x', 2),
    mult('2.5x', '2.5x', 2.5),
    mult('3x', '3x', 3),
    { id: 'allin', label: 'All-in', to: legal.maxTo, clamped: false },
  ];
}

/**
 * Slider snapping: multiples of `step` (half a big blind by default), but the
 * exact min and max are always reachable.
 */
export function snapTo(value: number, legal: LegalActions, step: number): number {
  const s = Math.max(1, Math.floor(step));
  if (value >= legal.maxTo - s / 2) return legal.maxTo;
  if (value <= legal.minTo + s / 2) return legal.minTo;
  return clampTo(Math.round(value / s) * s, legal);
}

/**
 * Intent for a sized amount. Choosing the maximum sends ALL_IN (when legal) so
 * the server applies its exact all-in total; otherwise BET/RAISE with `amount`
 * = the TOTAL street contribution ("to"), per the protocol.
 */
export function intentForAmount(legal: LegalActions, to: number): PlayerActionIntent {
  const kind = aggressiveKind(legal);
  const amount = clampTo(to, legal);
  if ((amount >= legal.maxTo && legal.canAllIn) || kind === null) return { type: 'ALL_IN' };
  return { type: kind, amount };
}

/** Button label for the check/call slot, e.g. "CHECK", "CALL 500". Null when neither is legal. */
export function passiveLabel(legal: LegalActions): string | null {
  if (legal.canCheck) return 'CHECK';
  if (legal.canCall) return `CALL ${formatChips(legal.callAmount)}`;
  return null;
}

/** Text for a sized action confirm button: "BET 600", "RAISE TO 1,500", "ALL-IN 12,450". */
export function sizedActionLabel(legal: LegalActions, to: number): string {
  const kind = aggressiveKind(legal);
  if (to >= legal.maxTo && legal.canAllIn) return `ALL-IN ${formatChips(to)}`;
  if (kind === 'RAISE') return `RAISE TO ${formatChips(to)}`;
  return `BET ${formatChips(to)}`;
}

/** Human summary of a seat's last action: "CALL 500", "RAISE TO 1,500", "ALL-IN 8,000". */
export function lastActionLabel(action: ActionType, toAmount: number, amount: number): string {
  switch (action) {
    case 'FOLD':
      return 'FOLD';
    case 'CHECK':
      return 'CHECK';
    case 'CALL':
      return `CALL ${formatChips(amount)}`;
    case 'BET':
      return `BET ${formatChips(toAmount)}`;
    case 'RAISE':
      return `RAISE TO ${formatChips(toAmount)}`;
    case 'ALL_IN':
      return `ALL-IN ${formatChips(toAmount)}`;
    default:
      return action;
  }
}
