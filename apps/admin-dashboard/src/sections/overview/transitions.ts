import type { Permission, TournamentStatus } from '@jpb/shared-types';
import type { IconName } from '@jpb/ui';
import type { TournamentControls } from '../../danger/useTournamentControls';

/** The FSM drawn on the Overview: the main path plus the side states. */
export const MAIN_PATH: readonly TournamentStatus[] = ['DRAFT', 'REGISTRATION', 'REGISTRATION_CLOSED', 'STARTING', 'RUNNING', 'FINAL_TABLE', 'COMPLETED'];
export const SIDE_STATES: readonly TournamentStatus[] = ['BREAK', 'PAUSED', 'CANCELLED'];

export type TransitionControl =
  | { kind: 'action'; label: string; icon: IconName; permission: Permission; danger: boolean; run: (c: TournamentControls, defaultBreakSeconds: number) => Promise<unknown> }
  | { kind: 'auto'; label: string };

/**
 * How each legal transition (from the server's `allowedTransitions`) is
 * triggered. Director-driven transitions (start of play, final table,
 * completion) have no button: Johnny makes them when the rules say so.
 */
export function controlFor(from: TournamentStatus, to: TournamentStatus, resumeTo: TournamentStatus | null): TransitionControl | null {
  if (to === 'CANCELLED') return { kind: 'action', label: 'Cancel tournament…', icon: 'ban', permission: 'TOURNAMENT_CANCEL', danger: true, run: (c) => c.cancel() };
  switch (to) {
    case 'REGISTRATION':
      return from === 'DRAFT'
        ? { kind: 'action', label: 'Open registration', icon: 'users', permission: 'TOURNAMENT_LIFECYCLE', danger: false, run: (c) => c.openRegistration() }
        : { kind: 'action', label: 'Reopen registration', icon: 'users', permission: 'TOURNAMENT_LIFECYCLE', danger: false, run: (c) => c.reopenRegistration() };
    case 'REGISTRATION_CLOSED':
      return { kind: 'action', label: 'Close registration', icon: 'lock', permission: 'TOURNAMENT_LIFECYCLE', danger: false, run: (c) => c.closeRegistration() };
    case 'STARTING':
      return { kind: 'action', label: 'Start tournament', icon: 'play', permission: 'TOURNAMENT_LIFECYCLE', danger: false, run: (c) => c.start() };
    case 'PAUSED':
      return { kind: 'action', label: 'Pause after hand', icon: 'pause', permission: 'TOURNAMENT_PAUSE', danger: false, run: (c) => c.pause() };
    case 'BREAK':
      if (from === 'PAUSED') return null;
      return { kind: 'action', label: 'Start break now', icon: 'coffee', permission: 'CLOCK_CONTROL', danger: false, run: (c, s) => c.startBreak(s) };
    case 'RUNNING':
    case 'FINAL_TABLE':
      if (from === 'PAUSED' && (resumeTo ?? 'RUNNING') === to) return { kind: 'action', label: 'Resume', icon: 'play', permission: 'TOURNAMENT_PAUSE', danger: false, run: (c) => c.resume() };
      if (from === 'BREAK' && to === 'RUNNING') return { kind: 'action', label: 'End break now', icon: 'skip-forward', permission: 'CLOCK_CONTROL', danger: false, run: (c) => c.endBreak() };
      return { kind: 'auto', label: to === 'FINAL_TABLE' ? 'Final table forms automatically' : 'Play starts automatically' };
    case 'COMPLETED':
      return { kind: 'auto', label: 'Completes when one player remains' };
    case 'DRAFT':
      return null;
    default:
      return null;
  }
}
