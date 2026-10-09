import { useMemo } from 'react';
import type { BlindLevel, TournamentOverviewDto } from '@jpb/shared-types';
import { formatChips, formatClock, formatCount } from '@jpb/ui';
import type { PreviewRow } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useDangerousAction } from '../../danger/DangerProvider';
import type { ClockModel } from '../../lib/clock';
import type { TournamentState } from '../../live/useTournamentState';
import type { RunningScheduleChanges } from './levelDraft';

const MINUTE = 60_000;

const blindsOf = (l: BlindLevel | undefined) => (l ? `${formatChips(l.smallBlind)} / ${formatChips(l.bigBlind)}${l.ante ? ` · ante ${formatChips(l.ante)}` : ''}` : '—');

/** "+1 min", "−5 min", "+2 min 30 s", "−45 s". */
export function formatDelta(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const total = Math.round(Math.abs(ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${sign}${m ? `${m} min` : ''}${m && s ? ' ' : ''}${s ? `${s} s` : ''}`;
}

export interface ClockActionContext {
  tournamentId: string;
  state: TournamentState;
  /** Undefined while the overview loads (the actions are only offered once it has). */
  overview: TournamentOverviewDto | undefined;
  model: ClockModel;
}

/**
 * Clock & structure actions (docs/API.md "Clock"): advance level (L1), set
 * level (L2 LEVEL), add/remove time (L1), hand-for-hand (L1) and the running
 * schedule edit (L2 EDIT). Pause/resume and breaks come from
 * useTournamentControls (shared with the top bar and the Overview FSM).
 */
export function useClockActions({ tournamentId: id, state, overview, model }: ClockActionContext) {
  const api = useApi();
  const danger = useDangerousAction();

  return useMemo(() => {
    const invalidate = [qk.tournament(id), qk.tournamentsAll()];
    const schedule = overview?.config.blindSchedule ?? [];
    const tables = state.counters?.tables ?? overview?.counters.tables ?? 0;
    const current = schedule[state.clock?.levelIndex ?? 0];
    /** Remaining time on the level/break right now (snapshot for the dialog copy). */
    const remainingNow = (): number | null => {
      if (model.ticking && model.deadline !== null) return Math.max(0, model.deadline - (Date.now() + state.offsetMs));
      return model.heldRemainingMs;
    };

    return {
      advance: () => {
        const next = schedule[(state.clock?.levelIndex ?? 0) + 1];
        return danger({
          level: 1,
          endpoint: 'clockAdvance',
          title: `Advance to level ${next?.level ?? '—'}`,
          summary: 'The next level starts now with a full clock. Tables pick up the new blinds from their next hand — a hand in progress is never interrupted.',
          consequences: [
            `Blinds: ${blindsOf(current)} → ${blindsOf(next)}`,
            `${formatCount(tables)} tables receive the new level`,
            `Level clock restarts at ${next ? formatClock(next.durationSeconds * 1000) : '—'}${model.phase === 'paused' || model.phase === 'frozen' ? ' (stays stopped until you resume)' : ''}`,
          ],
          reason: 'optional',
          confirmLabel: 'Advance level',
          run: ({ reason }) => api.clock.advance(id, reason ? { reason } : {}),
          success: `Level ${next?.level ?? ''} started`,
          invalidate,
        });
      },

      setLevel: (index: number) => {
        const target = schedule[index];
        const curIndex = state.clock?.levelIndex ?? 0;
        if (!target) return Promise.resolve(undefined);
        const direction = index < curIndex ? 'backwards' : index > curIndex + 1 ? 'skip' : index === curIndex ? 'restart' : 'next';
        const preview: PreviewRow[] = [
          { label: 'Level', before: `${current?.level ?? '—'} · ${blindsOf(current)}`, after: `${target.level} · ${blindsOf(target)}` },
          { label: 'Level clock', before: (() => {
            const r = remainingNow();
            return r === null ? '—' : `${formatClock(r)} left`;
          })(), after: `${formatClock(target.durationSeconds * 1000)} (full level)` },
        ];
        return danger({
          level: 2,
          endpoint: 'clockSetLevel',
          word: 'LEVEL',
          title: `Set blind level ${target.level}`,
          summary:
            direction === 'backwards'
              ? 'Moves the blind clock BACKWARDS. Use only to correct a mistake.'
              : direction === 'skip'
                ? `Skips ${index - curIndex - 1} level${index - curIndex - 1 === 1 ? '' : 's'}. Stacks become shallower faster.`
                : direction === 'restart'
                  ? 'Restarts the current level with a full clock.'
                  : 'Starts the next level now (same as “Advance level”).',
          consequences: [
            `${formatCount(tables)} tables use ${blindsOf(target)} from their next hand`,
            'Hands in progress finish with the current blinds',
            'Players and the big screen see the new level immediately',
            'A SET_BLIND_LEVEL audit entry records your name and reason',
          ],
          preview,
          confirmLabel: `Set level ${target.level}`,
          run: (d) => api.clock.setLevel(id, { ...d, level: target.level }),
          success: `Level ${target.level} set`,
          invalidate,
        });
      },

      addTime: (ms: number) => {
        const r = remainingNow();
        const what = model.onBreak ? 'Break' : `Level ${current?.level ?? ''}`;
        const after = r === null ? null : Math.max(0, r + ms);
        return danger({
          level: 1,
          endpoint: 'clockAddTime',
          title: `${ms > 0 ? 'Add' : 'Remove'} ${formatDelta(ms).slice(1)} ${ms > 0 ? 'to' : 'from'} the ${model.onBreak ? 'break' : 'level'}`,
          summary: r === null ? `${what} clock ${formatDelta(ms)}.` : `${what} clock: ${formatClock(r)} → ${formatClock(after ?? 0)}${model.ticking ? ' (approximately; it keeps running)' : ''}.`,
          consequences: [
            ms < 0 && after !== null && after < MINUTE ? `Less than a minute will be left: the ${model.onBreak ? 'break ends' : 'next level starts'} almost immediately` : `Every player and the big screen see the new countdown`,
            'Projected times of all later levels and breaks shift by the same amount',
          ],
          reason: 'optional',
          confirmLabel: ms > 0 ? `Add ${formatDelta(ms).slice(1)}` : `Remove ${formatDelta(ms).slice(1)}`,
          tone: ms < 0 ? 'danger' : 'primary',
          run: ({ reason }) => api.clock.addTime(id, { ms, ...(reason ? { reason } : {}) }),
          success: `Clock ${formatDelta(ms)}`,
          invalidate,
        });
      },

      handForHand: (enabled: boolean) =>
        danger({
          level: 1,
          endpoint: 'handForHand',
          title: enabled ? 'Turn hand-for-hand on' : 'Turn hand-for-hand off',
          summary: enabled
            ? 'Every table holds after each hand until all tables have finished theirs, then all deal together. Used on the money bubble.'
            : 'Tables deal at their own pace again.',
          consequences: enabled
            ? [`${formatCount(tables)} tables synchronise hand by hand`, 'Players who bust in the same round share the finishing positions by starting stack', 'Play slows down noticeably']
            : ['Tables no longer wait for each other'],
          reason: 'optional',
          confirmLabel: enabled ? 'Start hand-for-hand' : 'Stop hand-for-hand',
          run: ({ reason }) => api.clock.handForHand(id, { enabled, ...(reason ? { reason } : {}) }),
          success: enabled ? 'Hand-for-hand is on' : 'Hand-for-hand is off',
          invalidate,
        }),

      saveSchedule: (changes: RunningScheduleChanges, preview: PreviewRow[], moreRows: number) => {
        const added = (changes.blindSchedule?.length ?? schedule.length) - schedule.length;
        return danger({
          level: 2,
          endpoint: 'tournamentPatchRunningConfig',
          word: 'EDIT',
          title: 'Change future levels and breaks',
          summary: 'Edits the blind structure while the tournament runs. The current and past levels are never changed.',
          consequences: [
            ...(changes.blindSchedule ? [`Future levels change${added ? ` (${added > 0 ? '+' : '−'}${Math.abs(added)} level${Math.abs(added) === 1 ? '' : 's'})` : ''}; tables use them when each level starts`] : []),
            ...(changes.breaks ? ['Break rules change; a break already in progress keeps its end time'] : []),
            'Projected times update for players, the big screen and this screen',
            'A SCHEDULE_EDITED audit entry stores the full before and after structure',
            ...(moreRows > 0 ? [`${moreRows} more change(s) not listed in the preview`] : []),
          ],
          preview,
          confirmLabel: 'Save structure',
          run: (d) => api.tournaments.patchRunningConfig(id, { changes, reason: d.reason, confirm: d.confirm }),
          success: 'Structure updated',
          invalidate,
        });
      },
    };
  }, [api, danger, id, overview, state, model]);
}

export type ClockActions = ReturnType<typeof useClockActions>;
