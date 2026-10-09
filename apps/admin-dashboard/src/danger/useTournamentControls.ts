import { useMemo } from 'react';
import type { TournamentStatus } from '@jpb/shared-types';
import { TOURNAMENT_STATUS_META, formatClock, formatCount } from '@jpb/ui';
import { useApi } from '../api/ApiProvider';
import { qk } from '../api/query/keys';
import type { TournamentState } from '../live/useTournamentState';
import { clockModel } from '../lib/clock';
import { useDangerousAction } from './DangerProvider';

const statusLabel = (s: TournamentStatus | null) => (s ? TOURNAMENT_STATUS_META[s].label : '—');

/**
 * Tournament-level controls shared by the top bar, the Overview FSM and the
 * Clock screen, each with its danger level, copy and before/after preview.
 * Every function resolves to the API result, or undefined if cancelled.
 */
export function useTournamentControls(tournamentId: string | null, state: TournamentState) {
  const api = useApi();
  const danger = useDangerousAction();
  return useMemo(() => {
    const id = tournamentId ?? '';
    const invalidate = [qk.tournament(id), qk.tournamentsAll()];
    const tables = state.counters?.tables ?? 0;
    const clockText = (() => {
      const m = clockModel({ status: state.status, frozen: state.frozen, clock: state.clock, hasNextLevel: state.nextLevel !== null });
      if (m.phase === 'not-started' || m.phase === 'ended') return '—';
      if (m.phase === 'last-level') return 'last level · no end';
      if (m.ticking && m.deadline !== null) return `${m.onBreak ? 'break' : 'running'} · ${formatClock(Math.max(0, m.deadline - Date.now() - state.offsetMs))} left`;
      return m.heldRemainingMs === null ? m.label.toLowerCase() : `stopped at ${formatClock(m.heldRemainingMs)}`;
    })();

    return {
      pause: () =>
        danger({
          level: 1,
          endpoint: 'tournamentPause',
          title: 'Pause after current hands',
          summary: 'Every table finishes the hand in progress, then holds. The blind clock stops.',
          consequences: [`${formatCount(tables)} tables hold after their current hand`, 'Players see “Paused by the tournament director”', 'Resume continues exactly where the clock stopped'],
          reason: 'optional',
          confirmLabel: 'Pause after hand',
          run: ({ reason }) => api.lifecycle.pause(id, reason ? { reason } : {}),
          success: 'Pause requested — tables hold after their current hand',
          invalidate,
        }),
      resume: () =>
        danger({
          level: 1,
          endpoint: 'tournamentResume',
          title: 'Resume tournament',
          summary: 'Tables deal the next hand and the blind clock continues.',
          reason: 'optional',
          confirmLabel: 'Resume',
          run: ({ reason }) => api.lifecycle.resume(id, reason ? { reason } : {}),
          success: 'Tournament resumed',
          invalidate,
        }),
      freeze: () =>
        danger({
          level: 2,
          endpoint: 'tournamentFreeze',
          word: 'FREEZE',
          title: 'Emergency freeze',
          summary: 'Stops every table instantly — mid-hand — and the blind clock. Use for disputes, outages or security incidents.',
          consequences: [
            `No player action or timer is processed on any of the ${formatCount(tables)} tables`,
            'The acting player keeps their remaining action time for when you unfreeze',
            'Players and the big screen show “Tournament frozen by the director”',
            'An EMERGENCY_FREEZE audit entry is written with your name and reason',
          ],
          preview: [
            { label: 'Tournament', before: statusLabel(state.status), after: `${statusLabel(state.status)} · FROZEN` },
            { label: 'Tables accepting actions', before: formatCount(tables), after: '0' },
            { label: 'Blind clock', before: clockText, after: 'stopped' },
          ],
          confirmLabel: 'Freeze everything now',
          run: (d) => api.lifecycle.freeze(id, d),
          success: 'Emergency freeze active',
          invalidate,
        }),
      unfreeze: () =>
        danger({
          level: 2,
          endpoint: 'tournamentUnfreeze',
          word: 'FREEZE',
          title: 'Lift emergency freeze',
          summary: 'Tables resume processing actions and timers from exactly where they stopped.',
          consequences: ['The acting player gets back the action time they had left', 'The blind clock restarts from its frozen value'],
          preview: [
            { label: 'Tables accepting actions', before: '0', after: formatCount(tables) },
            { label: 'Blind clock', before: 'stopped', after: 'running' },
          ],
          confirmLabel: 'Unfreeze',
          run: (d) => api.lifecycle.unfreeze(id, d),
          success: 'Freeze lifted — play continues',
          invalidate,
        }),
      cancel: () =>
        danger({
          level: 2,
          endpoint: 'tournamentCancel',
          word: 'CANCEL',
          title: 'Cancel tournament',
          summary: 'Ends the tournament permanently. This cannot be undone.',
          consequences: [
            `All ${formatCount(state.counters?.active ?? 0)} remaining players are removed from their tables`,
            'No further hands are dealt; standings are frozen as they are',
            'The server seed can then be revealed for fairness verification',
          ],
          preview: [{ label: 'Status', before: statusLabel(state.status), after: 'Cancelled' }],
          confirmLabel: 'Cancel tournament',
          run: (d) => api.lifecycle.cancel(id, d),
          success: 'Tournament cancelled',
          invalidate,
        }),
      openRegistration: () =>
        danger({ level: 1, endpoint: 'registrationOpen', title: 'Open registration', summary: 'Players can register with the join code or QR.', confirmLabel: 'Open registration', run: () => api.lifecycle.openRegistration(id), success: 'Registration is open', invalidate }),
      closeRegistration: () =>
        danger({ level: 1, endpoint: 'registrationClose', title: 'Close registration', summary: 'No new players can register. You can reopen it before the start.', confirmLabel: 'Close registration', run: () => api.lifecycle.closeRegistration(id), success: 'Registration closed', invalidate }),
      reopenRegistration: () =>
        danger({ level: 1, endpoint: 'registrationReopen', title: 'Reopen registration', confirmLabel: 'Reopen registration', run: () => api.lifecycle.reopenRegistration(id), success: 'Registration reopened', invalidate }),
      start: () =>
        danger({
          level: 1,
          endpoint: 'tournamentStart',
          title: 'Start tournament',
          summary: `Seats ${formatCount(state.counters?.registered ?? 0)} registered players at random and starts the countdown to the first hand.`,
          consequences: ['The configuration locks (only future levels, breaks, timers and display settings stay editable)', 'Public entropy is fixed and the deck commitments begin'],
          confirmLabel: 'Start tournament',
          run: () => api.lifecycle.start(id),
          success: 'Tournament starting',
          invalidate,
        }),
      startBreak: (durationSeconds: number) =>
        danger({
          level: 1,
          endpoint: 'breakStart',
          title: `Start a ${Math.round(durationSeconds / 60)}-minute break now`,
          summary: 'Tables finish their current hand, then hold until the break ends.',
          reason: 'optional',
          confirmLabel: 'Start break',
          run: ({ reason }) => api.clock.startBreak(id, { durationSeconds, ...(reason ? { reason } : {}) }),
          success: 'Break started',
          invalidate,
        }),
      endBreak: () =>
        danger({ level: 1, endpoint: 'breakEnd', title: 'End break now', summary: 'Tables deal the next hand and the level clock resumes.', confirmLabel: 'End break', run: () => api.clock.endBreak(id), success: 'Break ended', invalidate }),
    };
  }, [api, danger, tournamentId, state]);
}

export type TournamentControls = ReturnType<typeof useTournamentControls>;
