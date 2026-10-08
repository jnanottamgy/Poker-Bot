import { useEffect, useRef } from 'react';
import type { LegalActions } from '@jpb/shared-types';
import { formatChips, useAnnouncer } from '@jpb/ui';
import { useSettings } from '../../settings/SettingsContext';

/** "Call 1,200 or fold" — the decision in words. */
export function turnDetail(legal: LegalActions): string {
  if (legal.canCheck) return legal.canBet || legal.canRaise ? 'Check or bet' : 'Check or fold';
  if (legal.canCall && legal.callAmount >= legal.stack) return `Call ${formatChips(legal.callAmount)} (all-in) or fold`;
  if (legal.canCall) return `Call ${formatChips(legal.callAmount)} to continue`;
  return 'Make your decision';
}

/** Sound / vibration / screen-reader cue once per new turn (all opt-in except the announcement). */
export function useTurnCues(turnVersion: number | null, legal: LegalActions | null): void {
  const { play, vibrate } = useSettings();
  const announcer = useAnnouncer();
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (turnVersion === null || turnVersion === last.current || !legal) return;
    last.current = turnVersion;
    play('your-turn');
    vibrate('your-turn');
    announcer?.announce(`Your turn. ${turnDetail(legal)}.`, 'assertive');
  }, [turnVersion, legal, play, vibrate, announcer]);
}
