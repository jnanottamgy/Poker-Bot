import { useEffect, useMemo, useState } from 'react';
import { ErrorState, Icon, Skeleton } from '@jpb/ui';
import { friendlyError } from '../../api/errors';
import { sectionHref } from '../../app/sections';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentControls } from '../../danger/useTournamentControls';
import { clockModel } from '../../lib/clock';
import { projectSchedule } from '../../lib/schedule';
import { useTournamentState } from '../../live/useTournamentState';
import { BigClock } from './BigClock';
import { ClockControls } from './ClockControls';
import { ScheduleTable } from './ScheduleTable';
import { SetLevelDialog } from './SetLevelDialog';
import { useClockActions } from './useClockActions';
import './clock.css';

/** Re-render period for projected times: fast while they float with "now" (clock stopped), slow otherwise. */
const TENTATIVE_TICK_MS = 5_000;
const STEADY_TICK_MS = 30_000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function ClockSkeleton() {
  return (
    <div className="acr-page acr-clock" aria-busy="true" aria-label="Loading clock and structure">
      <Skeleton width="28%" height={30} />
      <div className="acr-clock-hero">
        <Skeleton shape="block" height={360} />
        <div className="acr-clock-controls">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} shape="block" height={172} />
          ))}
        </div>
      </div>
      <Skeleton shape="block" height={420} />
    </div>
  );
}

/** §2.4 Clock & structure — big clock, every clock control, and the structure with projected times and inline editing. */
export default function ClockSection() {
  const tournamentId = useTournamentId();
  const state = useTournamentState(tournamentId);
  const controls = useTournamentControls(tournamentId, state);
  const overview = state.overview;
  const o = overview.data;
  const schedule = o?.config.blindSchedule ?? [];
  const levelIndex = state.clock?.levelIndex ?? 0;
  const model = useMemo(
    () => clockModel({ status: state.status, frozen: state.frozen, clock: state.clock, hasNextLevel: levelIndex < schedule.length - 1 }),
    [state.status, state.frozen, state.clock, levelIndex, schedule.length],
  );
  const clientNow = useNow(model.ticking ? STEADY_TICK_MS : TENTATIVE_TICK_MS);
  const now = clientNow + state.offsetMs;
  const projection = useMemo(
    () => projectSchedule({ schedule, breaks: o?.config.breaks ?? [], clock: state.clock, model, now, startTime: o?.config.startTime ?? null }),
    [schedule, o?.config.breaks, o?.config.startTime, state.clock, model, now],
  );
  const [setLevelOpen, setSetLevelOpen] = useState(false);

  const actions = useClockActions({ tournamentId, state, overview: o, model });

  if (overview.isLoading) return <ClockSkeleton />;
  if (!o) {
    return <ErrorState title="Could not load the clock" description={friendlyError(overview.error).description} onRetry={() => void overview.refetch()} />;
  }
  const started = model.phase !== 'not-started';
  const ended = model.phase === 'ended';

  return (
    <div className="acr-page acr-clock">
      <PageHeader
        title="Clock & Structure"
        icon="clock"
        eyebrow={o.name}
        description="The director runs the clock automatically. Every change here is confirmed, applied by the server and written to the audit log."
        actions={
          <>
            <ButtonLink to={sectionHref('overview', tournamentId)} icon="activity">
              Overview
            </ButtonLink>
            <ButtonLink to={sectionHref('audit', tournamentId)} icon="file">
              Audit log
            </ButtonLink>
          </>
        }
      />
      <div className={`acr-clock-hero${started && !ended ? '' : ' is-idle'}`}>
        <BigClock state={state} overview={o} model={model} projection={projection} />
        {started && !ended ? (
          <ClockControls tournamentId={tournamentId} state={state} overview={o} model={model} projection={projection} controls={controls} actions={actions} onSetLevel={() => setSetLevelOpen(true)} />
        ) : (
          <div className="acr-clock-callout" role="note">
            <Icon name="info" />
            <p>{ended ? 'The tournament has ended. The clock and structure are shown for reference only.' : 'Clock controls (pause, levels, time, breaks, hand-for-hand) become available when the tournament starts.'}</p>
          </div>
        )}
      </div>
      <ScheduleTable tournamentId={tournamentId} overview={o} levelIndex={levelIndex} clock={state.clock} model={model} projection={projection} now={now} actions={actions} />
      <SetLevelDialog
        open={setLevelOpen}
        schedule={schedule}
        currentIndex={levelIndex}
        onCancel={() => setSetLevelOpen(false)}
        onPick={(index) => {
          setSetLevelOpen(false);
          void actions.setLevel(index);
        }}
      />
    </div>
  );
}
