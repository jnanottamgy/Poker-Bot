import type { BreakRule } from '@jpb/shared-types';
import { Button, Icon, IconButton, Select, TextField, cx, formatCount } from '@jpb/ui';
import { CONFIG_LIMITS, breakMatchesLevel } from '@jpb/validation';
import type { ScheduleProjection } from '@jpb/validation';
import { useWizard } from '../components/context';
import { DurationField, NumberField, useFieldIssue } from '../components/fields';
import { Fact, Group, Note } from '../components/Group';
import { projection as projectLevels } from '../model/blinds';
import { durationLabel, isNum } from '../model/format';
import { fieldDomId } from '../model/issues';

/** A new break lasts this long (the STANDARD preset's break). */
const DEFAULT_BREAK_SECONDS = 600;
/** Levels listed by name in "after levels 6, 12, 18 …". */
const LISTED_LEVELS = 8;

type Kind = 'after' | 'every';
const kindOf = (b: BreakRule): Kind => (b.everyLevels !== undefined ? 'every' : 'after');

function levelsWithBreak(rule: BreakRule, levelCount: number): number[] {
  const out: number[] = [];
  // The last level never ends, so no break can follow it.
  for (let l = 1; l < levelCount; l++) if (breakMatchesLevel(rule, l)) out.push(l);
  return out;
}

function Timeline({ proj }: { proj: ScheduleProjection }) {
  const total = proj.levels.reduce((t, l, i) => t + (l.endsAtSeconds - l.startsAtSeconds) + (l.breakAfter && i < proj.levels.length - 1 ? l.breakAfter.durationSeconds : 0), 0);
  const breaks = proj.levels.filter((l, i) => l.breakAfter && i < proj.levels.length - 1);
  return (
    <div className="acr-setup-timeline">
      <div className="acr-setup-timeline__bar" role="img" aria-label={`${formatCount(proj.levels.length)} levels and ${formatCount(breaks.length)} breaks over ${durationLabel(total)}`}>
        {proj.levels.map((l, i) => (
          <span key={l.level} className="acr-setup-timeline__seg-wrap" style={{ flexGrow: l.endsAtSeconds - l.startsAtSeconds + (l.breakAfter && i < proj.levels.length - 1 ? l.breakAfter.durationSeconds : 0) }}>
            <span className={cx('acr-setup-timeline__seg', i % 2 === 1 && 'is-alt')} style={{ flexGrow: l.endsAtSeconds - l.startsAtSeconds }} title={`Level ${l.level} · ${durationLabel(l.endsAtSeconds - l.startsAtSeconds)}`} />
            {l.breakAfter && i < proj.levels.length - 1 && (
              <span className="acr-setup-timeline__break" style={{ flexGrow: l.breakAfter.durationSeconds }} title={`Break after level ${l.level} · ${durationLabel(l.breakAfter.durationSeconds)}`} />
            )}
          </span>
        ))}
      </div>
      <div className="acr-setup-timeline__legend">
        <span>
          <span className="acr-setup-timeline__key" aria-hidden="true" /> Levels
        </span>
        <span>
          <span className="acr-setup-timeline__key is-break" aria-hidden="true" /> <Icon name="coffee" /> Breaks
        </span>
        <span className="acr-setup-timeline__total jpb-num">{durationLabel(total)} in total</span>
      </div>
    </div>
  );
}

function BreakRow({ index, rule, levelCount }: { index: number; rule: BreakRule; levelCount: number }) {
  const { update } = useWizard();
  const kind = kindOf(rule);
  const message = useFieldIssue(`breaks[${index}].message`);
  const set = (fn: (b: BreakRule) => BreakRule) => update((c) => ({ ...c, breaks: c.breaks.map((b, i) => (i === index ? fn(b) : b)) }));
  const at = kind === 'every' ? rule.everyLevels : rule.afterLevel;
  const hits = isNum(at) ? levelsWithBreak(rule, levelCount) : [];
  const n = index + 1;
  return (
    <li className="acr-setup-break" id={fieldDomId(`breaks[${index}]`)} tabIndex={-1} aria-label={`Break ${n}`}>
      <span className="acr-setup-break__icon" aria-hidden="true">
        <Icon name="coffee" />
      </span>
      <div className="acr-setup-break__fields">
        <Select
          label="When"
          value={kind}
          options={[
            { value: 'after', label: 'After one level' },
            { value: 'every', label: 'Every N levels' },
          ]}
          onChange={(e) =>
            set((b) => {
              const value = b.afterLevel ?? b.everyLevels ?? 1;
              const { afterLevel: _a, everyLevels: _e, ...rest } = b;
              return e.target.value === 'every' ? { ...rest, everyLevels: value } : { ...rest, afterLevel: value };
            })
          }
        />
        {kind === 'every' ? (
          <NumberField path={`breaks[${index}].everyLevels`} label="Every" suffix="levels" value={rule.everyLevels ?? Number.NaN} onChange={(v) => set((b) => ({ ...b, everyLevels: v }))} />
        ) : (
          <NumberField path={`breaks[${index}].afterLevel`} label="After level" value={rule.afterLevel ?? Number.NaN} onChange={(v) => set((b) => ({ ...b, afterLevel: v }))} />
        )}
        <DurationField path={`breaks[${index}].durationSeconds`} label="Duration" value={rule.durationSeconds} onChange={(v) => set((b) => ({ ...b, durationSeconds: v }))} />
        <TextField
          id={message.id}
          label="Message on screens"
          error={message.error}
          className="acr-setup-break__msg"
          value={rule.message ?? ''}
          placeholder="e.g. Ten-minute break. Stretch your legs!"
          hint={`Optional · up to ${CONFIG_LIMITS.BREAK_MESSAGE_MAX_LENGTH} characters`}
          onChange={(e) =>
            set((b) => {
              const { message: _m, ...rest } = b;
              return e.target.value === '' ? rest : { ...rest, message: e.target.value };
            })
          }
        />
      </div>
      <div className="acr-setup-break__side">
        <p className="acr-setup-break__hits">
          {hits.length === 0 ? (
            <span className="acr-setup-dim">Never happens with this schedule</span>
          ) : (
            <>
              After level{hits.length === 1 ? '' : 's'} <span className="jpb-num">{hits.slice(0, LISTED_LEVELS).join(', ')}</span>
              {hits.length > LISTED_LEVELS ? ` and ${hits.length - LISTED_LEVELS} more` : ''}
            </>
          )}
        </p>
        <IconButton icon="x" size="sm" label={`Remove break ${n}`} onClick={() => update((c) => ({ ...c, breaks: c.breaks.filter((_, i) => i !== index) }))} />
      </div>
    </li>
  );
}

/** Step 4 — break rules (after level N / every N levels, duration, message) with a timeline of the event. */
export function BreaksStep() {
  const { config, update } = useWizard();
  const levelCount = config.blindSchedule.length;
  const proj = projectLevels(config.blindSchedule, config.breaks);
  const breakCount = proj ? proj.levels.filter((l, i) => l.breakAfter && i < proj.levels.length - 1).length : 0;
  const breakSeconds = proj ? proj.levels.reduce((t, l, i) => t + (l.breakAfter && i < proj.levels.length - 1 ? l.breakAfter.durationSeconds : 0), 0) : 0;
  const full = config.breaks.length >= CONFIG_LIMITS.MAX_BREAKS;
  const add = (rule: BreakRule) => update((c) => ({ ...c, breaks: [...c.breaks, rule] }));
  const middle = Math.max(1, Math.floor(levelCount / 2));

  return (
    <>
      <Group
        title="Break rules"
        icon="coffee"
        description="Breaks never interrupt a hand: tables finish their hand, then hold. If two rules match the same level, the first rule wins — the validator flags overlaps."
        id="setup-f-breaks"
        actions={
          <>
            <Button size="sm" icon="plus" disabled={full} onClick={() => add({ afterLevel: middle, durationSeconds: DEFAULT_BREAK_SECONDS })}>
              One-off break
            </Button>
            <Button size="sm" icon="refresh" disabled={full} onClick={() => add({ everyLevels: 6, durationSeconds: DEFAULT_BREAK_SECONDS, message: 'Scheduled break' })}>
              Recurring break
            </Button>
          </>
        }
      >
        {config.breaks.length === 0 ? (
          <p className="acr-setup-empty">
            <Icon name="coffee" /> No breaks: play runs from the first to the last level without stopping. The director can still start a break at any time from Clock &amp; Structure.
          </p>
        ) : (
          <ol className="acr-setup-breaks" aria-label="Break rules">
            {config.breaks.map((b, i) => (
              <BreakRow key={i} index={i} rule={b} levelCount={levelCount} />
            ))}
          </ol>
        )}
        {full && <Note tone="warning">At most {CONFIG_LIMITS.MAX_BREAKS} break rules.</Note>}
      </Group>

      <Group title="Event timeline" icon="clock" description="Projected clock time of every level and break (pauses and ad-hoc breaks not included).">
        <div className="acr-setup-facts">
          <Fact label="Breaks taken" value={formatCount(breakCount)} />
          <Fact label="Time on break" value={durationLabel(breakSeconds)} />
          <Fact label="Projected duration" value={proj ? durationLabel(proj.totalSeconds) : '—'} sub="Breaks included" />
        </div>
        {proj ? <Timeline proj={proj} /> : <Note tone="warning">Fix the level durations in Chips &amp; blinds to see the timeline.</Note>}
      </Group>
    </>
  );
}
