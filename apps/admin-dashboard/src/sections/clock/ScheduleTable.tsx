import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import type { BlindClockState, BlindLevel, BreakRule, TournamentOverviewDto } from '@jpb/shared-types';
import { Alert, Button, Icon, IconButton, Modal, Panel, StatusPill, cx, formatChips } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { useGate } from '../../auth/permissions';
import { ButtonLink } from '../../components/ButtonLink';
import type { ClockModel } from '../../lib/clock';
import { projectSchedule } from '../../lib/schedule';
import type { ProjectedBreak, Projection } from '../../lib/schedule';
import { formatTimeOfDay } from '../../lib/time';
import {
  addBreakAfter,
  breakDraftAfter,
  createDraft,
  draftBreaks,
  draftChanges,
  draftSchedule,
  insertLevel,
  removeBreak,
  removeLevel,
  restoreBreaks,
  scheduleDiff,
  updateBreak,
  updateLevel,
  validateDraft,
} from './levelDraft';
import type { BreakDraft, BreakErrors, DraftContext, LevelDraft, LevelErrors, LevelField, ScheduleDraft } from './levelDraft';
import type { ClockActions } from './useClockActions';

const PREVIEW_ROWS = 10;
const DAY_MS = 86_400_000;
const DEFAULT_NEW_BREAK_SECONDS = 600;
const EDITABLE = ['RUNNING', 'FINAL_TABLE', 'BREAK', 'PAUSED'];

/** "20:14", or "00:15 +1d" when the projected time falls on a later day. */
function clockTime(t: number | null, now: number): string {
  if (t === null) return '—';
  const days = Math.floor((new Date(t).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY_MS);
  return `${formatTimeOfDay(t, false)}${days > 0 ? ` +${days}d` : ''}`;
}

const minutesText = (secs: number) => (Number.isFinite(secs) ? `${Math.round((secs / 60) * 100) / 100} min` : '—');

/** Projection-safe copies (invalid draft numbers count as 0 so times stay computable). */
const safeLevels = (ls: BlindLevel[]) => ls.map((l) => ({ ...l, durationSeconds: Number.isFinite(l.durationSeconds) ? l.durationSeconds : 0 }));
const safeBreaks = (bs: BreakRule[]) => bs.map((b) => ({ ...b, durationSeconds: Number.isFinite(b.durationSeconds) ? b.durationSeconds : 0 }));

interface Props {
  tournamentId: string;
  overview: TournamentOverviewDto;
  levelIndex: number;
  /** Live director clock (socket when live, else REST). */
  clock: BlindClockState | null;
  model: ClockModel;
  projection: Projection;
  now: number;
  actions: ClockActions;
}

interface EditSession {
  draft: ScheduleDraft;
  ctx: DraftContext;
  /** Server structure the draft is based on (to detect concurrent changes). */
  signature: string;
}

const signatureOf = (o: TournamentOverviewDto, levelIndex: number) => JSON.stringify([o.config.blindSchedule, o.config.breaks, levelIndex]);

function contextFor(o: TournamentOverviewDto, levelIndex: number, model: ClockModel): DraftContext {
  const cfg = o.config;
  const currentNumber = cfg.blindSchedule[levelIndex]?.level ?? 1;
  return {
    schedule: cfg.blindSchedule,
    breaks: cfg.breaks,
    anteType: cfg.anteType,
    speedMode: cfg.speedMode,
    minLevels: Math.max(levelIndex + 1, cfg.lateRegistration.enabled ? cfg.lateRegistration.untilLevel : 0, cfg.reentry.enabled ? cfg.reentry.untilLevel : 0),
    // During a scheduled break the break after the current level is already running.
    editableBreaksFrom: model.onBreak && model.scheduledBreak ? currentNumber + 1 : currentNumber,
  };
}

function NumInput({ id, label, value, error, onChange, wide }: { id: string; label: string; value: string; error?: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <span className={cx('acr-clock-cell', error && 'is-invalid')}>
      <input
        id={id}
        className={cx('jpb-input acr-clock-input jpb-num', wide && 'is-wide')}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <span id={`${id}-err`} className="acr-clock-cell__err">
          <Icon name="warning" /> {error}
        </span>
      )}
    </span>
  );
}

function BreakRow({ brk, draft, errors, now, editable, editing, onChange, onRemove, cols }: { brk: ProjectedBreak | null; draft: BreakDraft | null; errors?: BreakErrors; now: number; editable: boolean; editing: boolean; onChange: (patch: Partial<BreakDraft>) => void; onRemove: () => void; cols: number }) {
  const recurring = draft ? draft.kind === 'every' : (brk?.recurring ?? false);
  const minutes = draft ? draft.minutes : brk ? String(Math.round((brk.durationSeconds / 60) * 100) / 100) : '';
  const message = draft ? draft.message : (brk?.message ?? '');
  const canEdit = editing && editable && draft !== null && !recurring;
  const id = `acr-brk-${draft?.key ?? brk?.ruleIndex ?? 'x'}`;
  return (
    <tr className={cx('acr-clock-break-row', errors && 'is-invalid')}>
      <td colSpan={cols}>
        <div className="acr-clock-break-row__inner">
          <span className="acr-clock-break-row__tag">
            <Icon name="coffee" /> Break
          </span>
          {canEdit ? (
            <>
              <NumInput id={`${id}-min`} label="Break length in minutes" value={minutes} error={errors?.minutes} onChange={(v) => onChange({ minutes: v })} />
              <span className="acr-clock-break-row__unit">min</span>
              <span className={cx('acr-clock-cell acr-clock-break-row__msg', errors?.message && 'is-invalid')}>
                <input
                  className="jpb-input acr-clock-input is-text"
                  aria-label="Break message shown to players (optional)"
                  placeholder="Message for players (optional)"
                  value={message}
                  maxLength={240}
                  onChange={(e) => onChange({ message: e.target.value })}
                />
              </span>
            </>
          ) : (
            <span className="acr-clock-break-row__len jpb-num">
              {minutes} min{message ? <span className="acr-clock-break-row__quote"> · “{message}”</span> : null}
            </span>
          )}
          {recurring && draft && <span className="acr-clock-break-row__rule">every {draft.at} levels{editing ? ' · edit below' : ''}</span>}
          {recurring && !draft && brk && <span className="acr-clock-break-row__rule">recurring</span>}
          {errors?.at && (
            <span className="acr-clock-cell__err">
              <Icon name="warning" /> {errors.at}
            </span>
          )}
          <span className="acr-clock-break-row__time jpb-num">{brk ? `${clockTime(brk.startsAt, now)} – ${clockTime(brk.endsAt, now)}` : ''}</span>
          {canEdit && <IconButton icon="x" size="sm" variant="danger" label="Remove this break" onClick={onRemove} />}
        </div>
      </td>
    </tr>
  );
}

function RecurringEditor({ draft, errors, onChange, onRemove }: { draft: ScheduleDraft; errors: Record<string, BreakErrors>; onChange: (key: string, patch: Partial<BreakDraft>) => void; onRemove: (key: string) => void }) {
  const rules = draft.breaks.filter((b) => !b.removed && b.kind === 'every');
  if (rules.length === 0) return null;
  return (
    <div className="acr-clock-recurring">
      <p className="acr-clock-recurring__title">
        <Icon name="refresh" /> Recurring breaks
      </p>
      {rules.map((b) => {
        const e = errors[b.key] ?? {};
        const id = `acr-rec-${b.key}`;
        return (
          <div key={b.key} className="acr-clock-recurring__row">
            <span>Every</span>
            <NumInput id={`${id}-n`} label="Break every N levels" value={b.at} error={e.at} onChange={(v) => onChange(b.key, { at: v })} />
            <span>levels for</span>
            <NumInput id={`${id}-m`} label="Recurring break length in minutes" value={b.minutes} error={e.minutes} onChange={(v) => onChange(b.key, { minutes: v })} />
            <span>min</span>
            <span className={cx('acr-clock-cell acr-clock-recurring__msg', e.message && 'is-invalid')}>
              <input className="jpb-input acr-clock-input is-text" aria-label="Recurring break message (optional)" placeholder="Message (optional)" value={b.message} maxLength={240} onChange={(ev) => onChange(b.key, { message: ev.target.value })} />
            </span>
            <IconButton icon="x" size="sm" variant="danger" label={`Remove the break every ${b.at} levels`} onClick={() => onRemove(b.key)} />
          </div>
        );
      })}
    </div>
  );
}

/** Upcoming levels with projected wall-clock times and breaks; inline edit of FUTURE levels and breaks (level 2, EDIT). */
export function ScheduleTable({ tournamentId, overview, levelIndex, clock, model, projection, now, actions }: Props) {
  const gate = useGate('TOURNAMENT_EDIT_CONFIG', tournamentId);
  const [session, setSession] = useState<EditSession | null>(null);
  const [showPlayed, setShowPlayed] = useState(false);
  const status = overview.status;
  const canEditRunning = overview.configLocked && EDITABLE.includes(status);
  const preStart = !overview.configLocked;

  const draft = session?.draft ?? null;
  const ctx = session?.ctx ?? null;
  const validation = useMemo(() => (session ? validateDraft(session.ctx, session.draft) : null), [session]);
  const changes = useMemo(() => (session ? draftChanges(session.ctx, session.draft) : {}), [session]);
  const dirty = Object.keys(changes).length > 0;
  const stale = session !== null && session.signature !== signatureOf(overview, levelIndex);

  // Projection of the draft while editing (times update as you type).
  const shown: Projection = useMemo(() => {
    if (!session) return projection;
    return projectSchedule({ schedule: safeLevels(draftSchedule(session.ctx, session.draft)), breaks: safeBreaks(draftBreaks(session.draft)), clock, model, now, startTime: overview.config.startTime });
  }, [session, projection, overview.config.startTime, clock, model, now]);

  // Leaving with unsaved changes: ask first (in-app navigation and tab close).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useBeforeUnload(
    useCallback(
      (e: BeforeUnloadEvent) => {
        if (!dirty) return;
        e.preventDefault();
        e.returnValue = '';
      },
      [dirty],
    ),
  );
  useEffect(() => {
    if (!dirty && blocker.state === 'blocked') blocker.proceed();
  }, [dirty, blocker]);

  const start = () => setSession({ draft: createDraft(overview.config.blindSchedule, overview.config.breaks, levelIndex), ctx: contextFor(overview, levelIndex, model), signature: signatureOf(overview, levelIndex) });
  const discard = () => setSession(null);
  const edit = (fn: (d: ScheduleDraft) => ScheduleDraft) => setSession((s) => (s ? { ...s, draft: fn(s.draft) } : s));

  const review = () => {
    if (!session || !dirty || stale || (validation?.count ?? 0) > 0) return;
    const after = draftSchedule(session.ctx, session.draft);
    const rows = scheduleDiff(session.ctx.schedule, after, session.ctx.breaks, session.draft);
    void actions.saveSchedule(changes, rows.slice(0, PREVIEW_ROWS), Math.max(0, rows.length - PREVIEW_ROWS)).then((r) => {
      if (r) setSession(null);
    });
  };

  const editing = session !== null;
  // Before the start the "average stack" is the starting stack (starting depth in big blinds).
  const avg = overview.stats.averageStack > 0 ? overview.stats.averageStack : overview.config.startingStack;
  const cols = editing ? 9 : 8;
  const played = shown.levels.filter((l) => l.played);
  const visible = shown.levels.filter((l) => !l.played || showPlayed);

  const levelCells = (l: BlindLevel, d: LevelDraft | null, e: LevelErrors | undefined, name: string): ReactNode => {
    if (d) {
      const field = (f: LevelField, label: string) => <NumInput id={`acr-lvl-${d.key}-${f}`} label={`${name} ${label}`} value={d[f]} error={e?.[f]} onChange={(v) => edit((x) => updateLevel(x, d.key, { [f]: v }))} />;
      return (
        <>
          <td className="is-num">{field('smallBlind', 'small blind')}</td>
          <td className="is-num">{field('bigBlind', 'big blind')}</td>
          <td className="is-num">{field('ante', 'ante')}</td>
          <td className="is-num">{field('minutes', 'duration in minutes')}</td>
        </>
      );
    }
    return (
      <>
        <td className="is-num jpb-num">{formatChips(l.smallBlind)}</td>
        <td className="is-num jpb-num">{formatChips(l.bigBlind)}</td>
        <td className="is-num jpb-num">{l.ante ? formatChips(l.ante) : '—'}</td>
        <td className="is-num jpb-num">{minutesText(l.durationSeconds)}</td>
      </>
    );
  };

  const headerActions = editing ? null : canEditRunning ? (
    <Button size="sm" icon="sliders" onClick={start} disabled={!gate.allowed} title={gate.reason ?? 'Edit future levels and breaks (current and past levels stay fixed)'}>
      Edit future levels & breaks
    </Button>
  ) : preStart ? (
    gate.allowed ? (
      <ButtonLink to={sectionHref('setup', tournamentId)} icon="sliders">
        Edit structure in setup
      </ButtonLink>
    ) : null
  ) : null;

  const totalLevels = editing && draft ? draft.fixedThrough + 1 + draft.levels.length : overview.config.blindSchedule.length;
  const removedBreaks = draft?.breaks.filter((b) => b.removed).length ?? 0;
  const lastProjected = shown.levels[shown.levels.length - 1];

  return (
    <Panel
      title="Structure — levels & breaks"
      icon="list"
      className={cx('acr-clock-structure', editing && 'is-editing')}
      description={
        <>
          {totalLevels} levels · {overview.config.anteType === 'NONE' ? 'no antes' : overview.config.anteType === 'BB_ANTE' ? 'big-blind ante' : 'ante from every player'}
          {' · '}
          {shown.tentative ? (
            <span className="acr-clock-tentative">
              <Icon name="pause" /> projected times assume the clock {model.phase === 'not-started' ? 'starts' : 'resumes'} now
            </span>
          ) : (
            'times are projected from the director clock'
          )}
        </>
      }
      actions={
        <>
          {played.length > 0 && (
            <Button size="sm" variant="ghost" icon={showPlayed ? 'chevron-up' : 'chevron-down'} aria-expanded={showPlayed} onClick={() => setShowPlayed((v) => !v)}>
              {showPlayed ? 'Hide' : 'Show'} {played.length} played
            </Button>
          )}
          {headerActions}
        </>
      }
      flush
    >
      {editing && (
        <div className="acr-clock-editbar" role="region" aria-label="Structure editor">
          <p className="acr-clock-editbar__text">
            <Icon name="sliders" /> Editing levels after level {(ctx?.schedule[draft!.fixedThrough]?.level ?? levelIndex + 1)}. Current and past levels are locked.
          </p>
          {stale && (
            <Alert
              severity="WARNING"
              title="The structure changed while you were editing"
              meta="A level started or another admin saved changes. Reload to edit the latest version (your changes are discarded)."
              actions={
                <Button size="sm" icon="refresh" onClick={start}>
                  Reload latest
                </Button>
              }
            />
          )}
          {validation && validation.general.length > 0 && (
            <ul className="acr-clock-general" role="alert">
              {validation.general.map((g) => (
                <li key={g}>
                  <Icon name="warning" /> {g}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {preStart && (
        <p className="acr-clock-note">
          <Icon name="info" /> Before the start the whole structure can change in setup{gate.allowed ? '' : ' (requires TOURNAMENT_EDIT_CONFIG)'}. Once the tournament starts, only future levels and breaks can change here.
        </p>
      )}
      <div className="acr-clock-tablewrap" role="region" aria-label="Blind structure (scrollable)" tabIndex={0}>
        <table className="acr-clock-table">
          <caption className="jpb-sr-only">Blind levels with projected start and end times. Breaks are listed between levels.</caption>
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col" className="is-num">
                Small blind
              </th>
              <th scope="col" className="is-num">
                Big blind
              </th>
              <th scope="col" className="is-num">
                Ante
              </th>
              <th scope="col" className="is-num">
                Duration
              </th>
              <th scope="col" className="is-num">
                Starts
              </th>
              <th scope="col" className="is-num">
                Ends
              </th>
              <th scope="col" className="is-num" title="Today's average stack expressed in this level's big blinds">
                Avg stack
              </th>
              {editing && (
                <th scope="col">
                  <span className="jpb-sr-only">Row actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {!showPlayed && played.length > 0 && (
              <tr className="acr-clock-played-row">
                <td colSpan={cols}>
                  <button type="button" className="acr-clock-played-row__btn" onClick={() => setShowPlayed(true)}>
                    <Icon name="check" /> Levels {played[0]!.level.level}–{played[played.length - 1]!.level.level} played · show
                  </button>
                </td>
              </tr>
            )}
            {shown.currentBreak && (
              <tr className="acr-clock-break-row is-now">
                <td colSpan={cols}>
                  <div className="acr-clock-break-row__inner">
                    <span className="acr-clock-break-row__tag">
                      <Icon name="coffee" /> Break
                    </span>
                    <StatusPill tone="info" size="sm" label="IN PROGRESS" live />
                    <span className="acr-clock-break-row__len">{shown.currentBreak.scheduled ? 'Scheduled break' : 'Started by staff — the level resumes after it'}</span>
                    <span className="acr-clock-break-row__time jpb-num">ends {clockTime(shown.currentBreak.endsAt, now)}</span>
                  </div>
                </td>
              </tr>
            )}
            {visible.map((pl) => {
              const pos = draft ? pl.index - draft.fixedThrough - 1 : -1;
              const d = draft && pos >= 0 ? (draft.levels[pos] ?? null) : null;
              const e = d && validation ? validation.levels[d.key] : undefined;
              const name = `Level ${pl.level.level}`;
              const isNext = !pl.played && !pl.isCurrent && pl.index === model.playIndex + (model.phase === 'not-started' || (model.onBreak && model.scheduledBreak) ? 0 : 1);
              const bd = editing && draft && !pl.played ? breakDraftAfter(draft, pl.level.level) : null;
              const brkEditable = ctx !== null && pl.level.level >= ctx.editableBreaksFrom;
              const showBreak = editing ? bd !== null && !pl.played : pl.breakAfter !== null;
              const bbAvg = avg > 0 && pl.level.bigBlind > 0 ? Math.round((avg / pl.level.bigBlind) * 10) / 10 : null;
              const isLast = pl.index === totalLevels - 1;
              return (
                <Fragment key={d?.key ?? `lvl-${pl.index}`}>
                  <tr className={cx('acr-clock-row', pl.played && 'is-played', pl.isCurrent && 'is-current', e && 'is-invalid', d && 'is-editable')} aria-current={pl.isCurrent ? 'step' : undefined}>
                    <th scope="row" className="acr-clock-row__level">
                      <span className="jpb-num">{pl.level.level}</span>
                      {pl.isCurrent && <span className="acr-clock-badge is-now">NOW</span>}
                      {isNext && <span className="acr-clock-badge is-next">NEXT</span>}
                      {pl.played && (
                        <span className="acr-clock-badge is-played">
                          <Icon name="check" /> played
                        </span>
                      )}
                      {editing && !d && !pl.played && <Icon name="lock" className="acr-clock-row__lock" aria-label="Locked: current level" />}
                    </th>
                    {levelCells(pl.level, d, e, name)}
                    <td className="is-num jpb-num acr-clock-row__time">{pl.played ? '—' : clockTime(pl.startsAt, now)}</td>
                    <td className="is-num jpb-num acr-clock-row__time">{pl.played ? '—' : isLast ? 'no end' : clockTime(pl.endsAt, now)}</td>
                    <td className="is-num jpb-num acr-clock-row__bb">{bbAvg !== null ? `${bbAvg.toLocaleString('en-US')} BB` : '—'}</td>
                    {editing && (
                      <td className="acr-clock-row__actions">
                        {!pl.played && (
                          <span className="acr-clock-row__btns">
                            <IconButton icon="plus" size="sm" label={`Insert a level after ${name}`} onClick={() => edit((x) => insertLevel(ctx!, x, pos))} />
                            <IconButton
                              icon="coffee"
                              size="sm"
                              label={`Add a break after ${name}`}
                              disabled={bd !== null || isLast || !brkEditable}
                              onClick={() => edit((x) => addBreakAfter(x, pl.level.level, overview.config.breaks.find((b) => b.afterLevel !== undefined)?.durationSeconds ?? DEFAULT_NEW_BREAK_SECONDS))}
                            />
                            {d && <IconButton icon="x" size="sm" variant="danger" label={`Remove ${name}`} onClick={() => edit((x) => removeLevel(ctx!, x, d.key))} />}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                  {showBreak && (
                    <BreakRow
                      brk={pl.breakAfter}
                      draft={bd}
                      errors={bd && validation ? validation.breaks[bd.key] : undefined}
                      now={now}
                      editable={brkEditable}
                      editing={editing}
                      cols={cols}
                      onChange={(patch) => bd && edit((x) => updateBreak(x, bd.key, patch))}
                      onRemove={() => bd && edit((x) => removeBreak(x, bd.key))}
                    />
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!editing && lastProjected && !lastProjected.played && (
        <p className="acr-clock-foot">
          <Icon name="flame" /> Final level {lastProjected.level.level} starts ≈ <strong className="jpb-num">{clockTime(lastProjected.startsAt, now)}</strong> and never ends — blinds stop increasing there.
        </p>
      )}
      {editing && draft && (
        <div className="acr-clock-editfoot">
          <div className="acr-clock-editfoot__tools">
            <Button size="sm" icon="plus" onClick={() => edit((x) => insertLevel(ctx!, x, x.levels.length - 1))}>
              Add level at the end
            </Button>
            {removedBreaks > 0 && (
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => edit(restoreBreaks)}>
                Undo {removedBreaks} removed break{removedBreaks === 1 ? '' : 's'}
              </Button>
            )}
          </div>
          <RecurringEditor draft={draft} errors={validation?.breaks ?? {}} onChange={(key, patch) => edit((x) => updateBreak(x, key, patch))} onRemove={(key) => edit((x) => removeBreak(x, key))} />
          <div className="acr-clock-savebar">
            <p className="acr-clock-savebar__status" role="status">
              {validation && validation.count > 0 ? (
                <span className="is-invalid">
                  <Icon name="warning" /> {validation.count} problem{validation.count === 1 ? '' : 's'} to fix before saving
                </span>
              ) : dirty ? (
                <span>
                  <Icon name="check-circle" /> {scheduleDiff(ctx!.schedule, draftSchedule(ctx!, draft), ctx!.breaks, draft).length} change(s) ready to review
                </span>
              ) : (
                <span>No changes yet</span>
              )}
            </p>
            <Button size="sm" variant="ghost" onClick={discard}>
              {dirty ? 'Discard changes' : 'Close editor'}
            </Button>
            <Button size="sm" variant="danger" icon="shield" disabled={!dirty || stale || (validation?.count ?? 0) > 0} onClick={review}>
              Review & save…
            </Button>
          </div>
        </div>
      )}
      <Modal
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Discard unsaved structure changes?"
        description="You edited future levels or breaks but did not save them. Leaving this screen discards the changes."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              Discard and leave
            </Button>
          </>
        }
      />
    </Panel>
  );
}

