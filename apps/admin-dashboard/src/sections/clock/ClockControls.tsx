import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { TournamentOverviewDto } from '@jpb/shared-types';
import { Button, ControlCard, Icon, Select, Toggle, formatChips, formatClock } from '@jpb/ui';
import { useGate } from '../../auth/permissions';
import type { TournamentControls } from '../../danger/useTournamentControls';
import type { ClockModel } from '../../lib/clock';
import type { Projection } from '../../lib/schedule';
import { formatTimeOfDay } from '../../lib/time';
import type { TournamentState } from '../../live/useTournamentState';
import type { ClockActions } from './useClockActions';

const MINUTE = 60_000;
/** Server limit for one add/remove: 1 s … 60 min (docs/API.md clock/add-time). */
export const MAX_ADJUST_MS = 60 * MINUTE;
/** Director limit for an ad-hoc break: 1 … 120 minutes. */
export const BREAK_MINUTES = { min: 1, max: 120 } as const;
const BREAK_PRESETS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const QUICK_ADJUST = [-5, -1, 1, 5];
const IN_PLAY = ['RUNNING', 'FINAL_TABLE', 'BREAK', 'PAUSED'];
const LEVEL_CHANGE = ['RUNNING', 'FINAL_TABLE', 'PAUSED'];

/**
 * Parses a custom clock adjustment: "2" (minutes), "2.5" (minutes), "2:30"
 * (m:ss) or "45s" (seconds). Returns ms, or null when not understood.
 */
export function parseAdjust(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  let m = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000;
  m = /^(\d{1,4})\s*s(ec(onds?)?)?$/.exec(t);
  if (m) return Number(m[1]) * 1000;
  m = /^(\d{1,3}(\.\d{1,2})?)\s*(m|min|mins|minutes?)?$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60) * 1000;
  return null;
}

interface CardProps {
  tournamentId: string;
  state: TournamentState;
  overview: TournamentOverviewDto;
  model: ClockModel;
  projection: Projection;
  controls: TournamentControls;
  actions: ClockActions;
}

function Why({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <p className="acr-clock-why">
      <Icon name="info" /> {children}
    </p>
  );
}

function LevelCard({ tournamentId, state, overview, model, projection, actions, onSetLevel }: CardProps & { onSetLevel: () => void }) {
  const gate = useGate('CLOCK_CONTROL', tournamentId);
  const schedule = overview.config.blindSchedule;
  const index = state.clock?.levelIndex ?? 0;
  const cur = schedule[index];
  const status = state.status ?? overview.status;
  const allowed = LEVEL_CHANGE.includes(status);
  const isLast = index >= schedule.length - 1;
  const why = !allowed ? (status === 'BREAK' ? 'Level changes are possible once the break ends.' : 'Only while the tournament is in play.') : null;
  const next = schedule[index + 1];
  const nextStart = projection.levels.find((l) => l.index === index + 1)?.startsAt ?? null;
  const lastStart = projection.levels[projection.levels.length - 1]?.startsAt ?? null;
  return (
    <ControlCard
      title="Level"
      icon="sliders"
      description="Advance (one confirmation) or jump to any level (type LEVEL + reason)."
      state={
        model.phase === 'not-started' ? (
          'Clock not started'
        ) : (
          <>
            Level <strong className="jpb-num">{cur?.level ?? '—'}</strong> of {schedule.length}
            {cur && (
              <span className="jpb-num">
                {' '}
                · {formatChips(cur.smallBlind)} / {formatChips(cur.bigBlind)}
                {cur.ante ? ` · ante ${formatChips(cur.ante)}` : ''}
              </span>
            )}
          </>
        )
      }
      lockedPermission={gate.lockedPermission}
      className="acr-clock-card"
    >
      <Button size="sm" variant="primary" icon="skip-forward" disabled={!allowed || isLast} title={isLast ? 'Already at the last level' : (why ?? undefined)} onClick={() => void actions.advance()}>
        Advance level
      </Button>
      <Button size="sm" variant="danger-outline" icon="sliders" disabled={!allowed} title={why ?? undefined} onClick={onSetLevel}>
        Set level…
      </Button>
      <Why>{gate.allowed ? (why ?? (isLast && allowed ? 'This is the last level: blinds stop increasing.' : null)) : null}</Why>
      <dl className="acr-clock-meta">
        <div>
          <dt>Next level</dt>
          <dd className="jpb-num">{next ? `${next.level} · ${formatChips(next.smallBlind)} / ${formatChips(next.bigBlind)}${next.ante ? ` · ante ${formatChips(next.ante)}` : ''}` : 'none'}</dd>
        </div>
        <div>
          <dt>Next level starts</dt>
          <dd className="jpb-num">{nextStart ? `${formatTimeOfDay(nextStart, false)}${projection.tentative ? ' (if resumed now)' : ''}` : '—'}</dd>
        </div>
        <div>
          <dt>Levels left</dt>
          <dd className="jpb-num">{Math.max(0, schedule.length - 1 - index)}</dd>
        </div>
        <div>
          <dt>Last level starts</dt>
          <dd className="jpb-num">{lastStart ? formatTimeOfDay(lastStart, false) : '—'}</dd>
        </div>
      </dl>
    </ControlCard>
  );
}

function TimeCard({ tournamentId, state, overview, model, projection, actions }: CardProps) {
  const gate = useGate('CLOCK_CONTROL', tournamentId);
  const id = useId();
  const [dir, setDir] = useState<1 | -1>(1);
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const status = state.status ?? overview.status;
  const inPlay = IN_PLAY.includes(status);
  const why = !inPlay ? 'Only while the tournament is in play.' : model.phase === 'last-level' ? 'The last level has no end time to change.' : null;
  const disabled = why !== null;
  const ms = parseAdjust(text);
  const error = !touched || !text.trim() ? null : ms === null ? 'Use minutes (2), m:ss (2:30) or seconds (45s)' : ms < 1000 || ms > MAX_ADJUST_MS ? 'Between 1 second and 60 minutes' : null;
  const target = model.onBreak ? 'break' : 'level';
  const ends = model.onBreak ? projection.currentBreak?.endsAt : projection.levels.find((l) => l.index === model.playIndex)?.endsAt;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (ms === null || ms < 1000 || ms > MAX_ADJUST_MS || disabled) return;
    void actions.addTime(dir * ms).then((r) => {
      if (r) {
        setText('');
        setTouched(false);
      }
    });
  };

  return (
    <ControlCard
      title={`Add / remove time`}
      icon="clock"
      description={`Changes the current ${target}'s countdown. Later levels shift with it.`}
      state={
        model.phase === 'last-level' ? (
          'Last level — no end time'
        ) : ends ? (
          <>
            Current {target} ends <strong className="jpb-num">{formatTimeOfDay(ends, false)}</strong>
            {projection.tentative ? ' if resumed now' : ''}
          </>
        ) : (
          'Clock not running'
        )
      }
      lockedPermission={gate.lockedPermission}
      className="acr-clock-card"
    >
      <div className="acr-clock-quick" role="group" aria-label={`Quick adjust the ${target} clock`}>
        {QUICK_ADJUST.map((m) => (
          <Button key={m} size="sm" variant={m < 0 ? 'danger-outline' : 'secondary'} disabled={disabled} title={why ?? undefined} onClick={() => void actions.addTime(m * MINUTE)} aria-label={`${m > 0 ? 'Add' : 'Remove'} ${Math.abs(m)} minute${Math.abs(m) === 1 ? '' : 's'}`}>
            {m > 0 ? '+' : '−'}
            {Math.abs(m)} min
          </Button>
        ))}
      </div>
      <form className="acr-clock-custom" onSubmit={submit} noValidate aria-label="Custom time adjustment">
        <div className="acr-clock-seg" role="group" aria-label="Add or remove">
          <button type="button" className="acr-clock-seg__btn" aria-pressed={dir === 1} onClick={() => setDir(1)} disabled={disabled}>
            <Icon name="plus" /> Add
          </button>
          <button type="button" className="acr-clock-seg__btn" aria-pressed={dir === -1} onClick={() => setDir(-1)} disabled={disabled}>
            <Icon name="minus" /> Remove
          </button>
        </div>
        <label className="jpb-sr-only" htmlFor={`${id}-custom`}>
          Custom amount (minutes, m:ss or seconds)
        </label>
        <input
          id={`${id}-custom`}
          className={`jpb-input acr-clock-custom__input jpb-num${error ? ' is-invalid' : ''}`}
          inputMode="decimal"
          placeholder="m:ss"
          value={text}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : `${id}-hint`}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        <Button type="submit" size="sm" disabled={disabled || !text.trim()}>
          Apply
        </Button>
      </form>
      {error ? (
        <p id={`${id}-err`} className="acr-clock-err" role="alert">
          <Icon name="warning" /> {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="acr-clock-hint">
          {ms !== null && text.trim() ? `${dir > 0 ? 'Adds' : 'Removes'} ${formatClock(ms)} (m:ss)` : 'Minutes, m:ss or seconds — up to 60 minutes at a time.'}
        </p>
      )}
      <Why>{gate.allowed ? why : null}</Why>
    </ControlCard>
  );
}

function BreakCard({ tournamentId, state, overview, model, projection, controls }: CardProps) {
  const gate = useGate('CLOCK_CONTROL', tournamentId);
  const id = useId();
  const status = state.status ?? overview.status;
  const defaultMinutes = Math.round((overview.config.breaks[0]?.durationSeconds ?? 600) / 60);
  const [preset, setPreset] = useState(String(BREAK_PRESETS.includes(defaultMinutes) ? defaultMinutes : 10));
  const [custom, setCustom] = useState('');
  const minutes = preset === 'custom' ? Number(custom) : Number(preset);
  const customError = preset === 'custom' && custom.trim() !== '' && (!Number.isInteger(minutes) || minutes < BREAK_MINUTES.min || minutes > BREAK_MINUTES.max) ? `Whole minutes, ${BREAK_MINUTES.min}–${BREAK_MINUTES.max}` : null;
  const valid = Number.isInteger(minutes) && minutes >= BREAK_MINUTES.min && minutes <= BREAK_MINUTES.max;
  const canStart = status === 'RUNNING' || status === 'FINAL_TABLE';
  const onBreak = status === 'BREAK';
  const nextBreak = projection.levels.find((l) => !l.played && l.breakAfter)?.breakAfter ?? null;
  const nextBreakLevel = projection.levels.find((l) => !l.played && l.breakAfter)?.level.level;
  const why = onBreak ? null : !canStart ? (status === 'PAUSED' ? 'Resume play before starting a break.' : 'Only while the tournament is in play.') : null;

  return (
    <ControlCard
      title="Breaks"
      icon="coffee"
      tone={onBreak ? 'warning' : 'default'}
      description="Tables finish their hand, then hold. An ad-hoc break resumes the same level with the time it had left."
      state={
        onBreak ? (
          <>
            On break{projection.currentBreak ? <> · ends <strong className="jpb-num">{formatTimeOfDay(projection.currentBreak.endsAt, false)}</strong></> : ''}
            {model.scheduledBreak ? ' · scheduled' : ' · started by staff'}
          </>
        ) : nextBreak ? (
          <>
            Next scheduled: {Math.round(nextBreak.durationSeconds / 60)} min after level {nextBreakLevel} · ≈ <strong className="jpb-num">{formatTimeOfDay(nextBreak.startsAt, false)}</strong>
          </>
        ) : (
          'No more scheduled breaks'
        )
      }
      lockedPermission={gate.lockedPermission}
      className="acr-clock-card"
    >
      {onBreak ? (
        <Button size="sm" variant="primary" icon="skip-forward" onClick={() => void controls.endBreak()}>
          End break now
        </Button>
      ) : (
        <div className="acr-clock-break">
          <Select
            label="Duration"
            hideLabel
            id={`${id}-dur`}
            value={preset}
            disabled={!canStart}
            onChange={(e) => setPreset(e.target.value)}
            options={[...BREAK_PRESETS.map((m) => ({ value: String(m), label: `${m} minutes` })), { value: 'custom', label: 'Custom…' }]}
            className="acr-clock-break__select"
          />
          {preset === 'custom' && (
            <>
              <label className="jpb-sr-only" htmlFor={`${id}-custom`}>
                Break length in minutes ({BREAK_MINUTES.min}–{BREAK_MINUTES.max})
              </label>
              <input
                id={`${id}-custom`}
                className={`jpb-input acr-clock-break__custom jpb-num${customError ? ' is-invalid' : ''}`}
                inputMode="numeric"
                placeholder="min"
                value={custom}
                disabled={!canStart}
                aria-invalid={customError ? true : undefined}
                aria-describedby={customError ? `${id}-err` : undefined}
                onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ''))}
              />
            </>
          )}
          <Button size="sm" icon="coffee" disabled={!canStart || !valid} title={why ?? undefined} onClick={() => void controls.startBreak(minutes * 60)}>
            Start break now
          </Button>
        </div>
      )}
      {customError && (
        <p id={`${id}-err`} className="acr-clock-err" role="alert">
          <Icon name="warning" /> {customError}
        </p>
      )}
      <Why>{gate.allowed ? why : null}</Why>
    </ControlCard>
  );
}

function FlowCard({ tournamentId, state, overview, controls, actions }: CardProps) {
  const pauseGate = useGate('TOURNAMENT_PAUSE', tournamentId);
  const tableGate = useGate('TABLE_CONTROL', tournamentId);
  const status = state.status ?? overview.status;
  const paused = status === 'PAUSED';
  const canPause = overview.allowedTransitions.includes('PAUSED') || ['RUNNING', 'FINAL_TABLE', 'BREAK'].includes(status);
  const tables = state.counters?.tables ?? overview.counters.tables;
  const h4hOn = state.handForHand;
  const h4hWhy = h4hOn ? null : status !== 'RUNNING' ? 'Hand-for-hand can start while the tournament is running (not on the final table).' : tables < 2 ? 'Needs at least two tables.' : null;
  return (
    <section className="acr-clock-card acr-clock-flow" aria-label="Play">
      <ControlCard
        title={paused ? 'Paused' : 'Pause after hand'}
        icon={paused ? 'play' : 'pause'}
        tone={paused ? 'warning' : 'default'}
        description={paused ? 'Tables are holding. Resume continues the clock exactly where it stopped.' : 'Every table finishes its current hand, then holds. The clock stops.'}
        lockedPermission={pauseGate.lockedPermission}
      >
        {paused ? (
          <Button size="sm" variant="primary" icon="play" onClick={() => void controls.resume()}>
            Resume
          </Button>
        ) : (
          <Button size="sm" icon="pause" disabled={!canPause || state.frozen} title={state.frozen ? 'Lift the emergency freeze first' : undefined} onClick={() => void controls.pause()}>
            Pause after hand
          </Button>
        )}
        <Why>{pauseGate.allowed && !paused && !canPause ? 'Only while the tournament is in play.' : null}</Why>
      </ControlCard>
      <ControlCard
        title="Hand-for-hand"
        icon="split"
        tone={h4hOn ? 'warning' : 'default'}
        description={overview.config.handForHand.autoAtBubble ? 'Turns on automatically at the money bubble; you can also switch it here.' : 'Automatic bubble switching is off for this tournament.'}
        lockedPermission={tableGate.lockedPermission}
      >
        <Toggle checked={h4hOn} onChange={(v) => void actions.handForHand(v)} label={h4hOn ? 'On — tables deal hand by hand' : 'Off — tables play at their own pace'} disabled={!h4hOn && h4hWhy !== null} />
        <Why>{tableGate.allowed ? h4hWhy : null}</Why>
      </ControlCard>
    </section>
  );
}

/** §2.4 controls: level, time, breaks, pause / resume and hand-for-hand. */
export function ClockControls(props: CardProps & { onSetLevel: () => void }) {
  return (
    <div className="acr-clock-controls">
      <LevelCard {...props} />
      <TimeCard {...props} />
      <BreakCard {...props} />
      <FlowCard {...props} />
    </div>
  );
}
