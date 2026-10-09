import { useState } from 'react';
import type { AnteType } from '@jpb/shared-types';
import { Button, Icon, Select, Sparkline, Toggle, cx, formatChips, formatCount } from '@jpb/ui';
import { BLIND_PRESETS, BLIND_PRESET_NAMES, CONFIG_LIMITS } from '@jpb/validation';
import type { BlindPresetName } from '@jpb/validation';
import { useWizard } from '../components/context';
import { DurationField, NumberField, useFieldIssue } from '../components/fields';
import { Fact, Group, Note } from '../components/Group';
import { IssueList } from '../components/IssueList';
import {
  appendLevel,
  generate,
  generatorDefaults,
  generatorProblems,
  matchingBlindPreset,
  projection as projectLevels,
  recomputeAntes,
  scaleTo,
  setAllDurations,
  stackIsUsable,
  startingDepth,
  withPreset,
} from '../model/blinds';
import type { GeneratorOptions } from '../model/blinds';
import { bbText, durationLabel, isNum } from '../model/format';
import { ScheduleEditor } from './ScheduleEditor';

const ANTE_OPTIONS: ReadonlyArray<{ value: AnteType; label: string }> = [
  { value: 'NONE', label: 'No ante' },
  { value: 'BB_ANTE', label: 'Big-blind ante (the BB posts it for the table)' },
  { value: 'ALL_PLAYERS', label: 'Every player antes (≈ 10 % of the BB)' },
];

const PRESET_LABEL: Readonly<Record<BlindPresetName, string>> = { STANDARD: 'Standard', TURBO: 'Turbo', HYPER: 'Hyper', SPEED_TEST: 'Speed test' };

/** Step 3 — starting stack, antes, presets / generator, the schedule editor and its projection. */
export function BlindsStep() {
  const { config, meta, update, setMeta, validation } = useWizard();
  const [gen, setGen] = useState<GeneratorOptions>(() => generatorDefaults('STANDARD', meta.anteFromLevel));
  const [bulkSeconds, setBulkSeconds] = useState(isNum(config.blindSchedule[0]?.durationSeconds) ? config.blindSchedule[0]!.durationSeconds : BLIND_PRESETS.STANDARD.levelDurationSeconds);
  const anteIssue = useFieldIssue('anteType');
  const levels = config.blindSchedule;
  const proj = projectLevels(levels, config.breaks);
  const depth = startingDepth(config.startingStack, levels);
  const activePreset = matchingBlindPreset(config);
  const needsScaling = stackIsUsable(config.startingStack) && stackIsUsable(meta.scheduleBaseStack) && config.startingStack !== meta.scheduleBaseStack;
  const genProblems = generatorProblems(gen, config.startingStack);
  const scheduleIssues = validation.issues.filter((i) => i.path === 'blindSchedule');
  const bigBlinds = levels.map((l) => l.bigBlind).filter(isNum);
  const lastLevel = levels[levels.length - 1];

  const applyNamedPreset = (name: BlindPresetName) => {
    const next = withPreset(config, name);
    if (!next) return;
    update(() => next, { undoLabel: `Applied the ${PRESET_LABEL[name]} preset (schedule, breaks, timing and speed mode)` });
    setMeta({ scheduleBaseStack: config.startingStack, anteFromLevel: 1 });
  };
  const runGenerator = () => {
    const schedule = generate(gen, config.startingStack, config.anteType);
    if (!schedule) return;
    update((c) => ({ ...c, blindSchedule: schedule }), { undoLabel: `Generated ${schedule.length} levels from the ${PRESET_LABEL[gen.preset]} ladder` });
    setMeta({ scheduleBaseStack: config.startingStack, anteFromLevel: gen.anteFromLevel });
  };
  const scale = () => {
    const scaled = scaleTo(levels, meta.scheduleBaseStack, config.startingStack);
    if (!scaled) return;
    update((c) => ({ ...c, blindSchedule: scaled }), { undoLabel: `Scaled the schedule from ${formatChips(meta.scheduleBaseStack)} to ${formatChips(config.startingStack)} chips` });
    setMeta({ scheduleBaseStack: config.startingStack });
  };
  const setAnteType = (anteType: AnteType) => {
    update((c) => ({ ...c, anteType, blindSchedule: recomputeAntes(c.blindSchedule, anteType, meta.anteFromLevel) }), { undoLabel: 'Recalculated every ante for the new ante type' });
  };

  return (
    <>
      <Group title="Chips" icon="layers" description="Chips are tournament chips only — never money.">
        <div className="acr-setup-grid acr-setup-grid--3">
          <NumberField path="startingStack" label="Starting stack" required grouping suffix="chips" value={config.startingStack} onChange={(v) => update((c) => ({ ...c, startingStack: v }))} />
          <Select
            id={anteIssue.id}
            label="Ante type"
            value={config.anteType}
            error={anteIssue.error}
            options={ANTE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(e) => setAnteType(e.target.value as AnteType)}
            hint="Changing it recalculates every level's ante (undo available)."
          />
          <NumberField
            path="__anteFrom"
            label="Antes start at level"
            value={meta.anteFromLevel}
            onChange={(v) => setMeta({ anteFromLevel: isNum(v) && v >= 1 ? Math.trunc(v) : 1 })}
            hint={config.anteType === 'NONE' ? 'Used when antes are enabled' : 'Earlier levels have no ante'}
          />
        </div>
        {config.anteType !== 'NONE' && (
          <div className="acr-setup-inline">
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => setAnteType(config.anteType)}>
              Recalculate antes from level {meta.anteFromLevel}
            </Button>
          </div>
        )}
        {needsScaling && (
          <div className="acr-setup-callout" role="status">
            <Icon name="info" />
            <span>
              The schedule was built for <strong className="jpb-num">{formatChips(meta.scheduleBaseStack)}</strong> chips. Scale it to{' '}
              <strong className="jpb-num">{formatChips(config.startingStack)}</strong> to keep the same depth in big blinds?
            </span>
            <Button size="sm" variant="primary" icon="zap" onClick={scale}>
              Scale to starting stack
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMeta({ scheduleBaseStack: config.startingStack })}>
              Keep blinds
            </Button>
          </div>
        )}
      </Group>

      <Group title="Presets" icon="zap" description="A preset replaces the schedule (for this stack and ante type), the breaks, the timers and speed mode. You can undo it.">
        <div className="acr-setup-blindpresets">
          {BLIND_PRESET_NAMES.map((name) => {
            const p = BLIND_PRESETS[name];
            const active = activePreset === name;
            return (
              <button key={name} type="button" className={cx('acr-setup-blindpreset', active && 'is-active', p.speedMode && 'is-speed')} aria-pressed={active} disabled={!stackIsUsable(config.startingStack)} onClick={() => applyNamedPreset(name)}>
                <span className="acr-setup-blindpreset__head">
                  <span className="acr-setup-blindpreset__name">{PRESET_LABEL[name]}</span>
                  {active ? (
                    <span className="acr-setup-blindpreset__state">
                      <Icon name="check-circle" /> In use
                    </span>
                  ) : p.speedMode ? (
                    <span className="acr-setup-blindpreset__state is-warn">
                      <Icon name="warning" /> Speed mode
                    </span>
                  ) : null}
                </span>
                <span className="acr-setup-blindpreset__stats jpb-num">
                  {durationLabel(p.levelDurationSeconds)} levels · {p.startingDepthBB} BB deep · {p.levels} levels
                </span>
                <span className="acr-setup-blindpreset__desc">{p.description}</span>
              </button>
            );
          })}
        </div>
        <details className="acr-setup-details">
          <summary>
            <Icon name="sliders" /> Generator — build a schedule from the ladder with your own level count, duration and depth
          </summary>
          <div className="acr-setup-details__body">
            <div className="acr-setup-grid acr-setup-grid--5">
              <Select label="Ladder" value={gen.preset} options={BLIND_PRESET_NAMES.map((n) => ({ value: n, label: PRESET_LABEL[n] }))} onChange={(e) => setGen(generatorDefaults(e.target.value as BlindPresetName, gen.anteFromLevel))} />
              <NumberField path="__gen.levels" label="Levels" value={gen.levels} onChange={(v) => setGen({ ...gen, levels: v })} hint={`1–${CONFIG_LIMITS.MAX_BLIND_LEVELS}`} />
              <DurationField path="__gen.duration" label="Level duration" value={gen.levelDurationSeconds} onChange={(v) => setGen({ ...gen, levelDurationSeconds: v })} />
              <NumberField path="__gen.depth" label="Starting depth" suffix="BB" value={gen.startingDepthBB} onChange={(v) => setGen({ ...gen, startingDepthBB: v })} />
              <NumberField path="__gen.ante" label="Antes from level" value={gen.anteFromLevel} onChange={(v) => setGen({ ...gen, anteFromLevel: v })} />
            </div>
            {genProblems.length > 0 && (
              <ul className="acr-setup-groupissues">
                {genProblems.map((p) => (
                  <li key={p}>
                    <Icon name="warning" /> {p}
                  </li>
                ))}
              </ul>
            )}
            <div className="acr-setup-inline">
              <Button size="sm" variant="primary" icon="zap" disabled={genProblems.length > 0} onClick={runGenerator}>
                Generate schedule
              </Button>
              <span className="acr-setup-dim">BB(1) ≈ stack ÷ depth on the ladder 2, 3, 4, 6, 10, 15, 20, 30, 40, 60 × 10ᵏ; SB = ⌊BB ÷ 2⌋. Breaks and timers are kept.</span>
            </div>
          </div>
        </details>
        <Toggle
          id="setup-f-speedMode"
          checked={config.speedMode}
          onChange={(v) => update((c) => ({ ...c, speedMode: v }))}
          label="Speed mode (developer / simulation)"
          description="Allows levels and breaks under a minute and action timers under 5 s. Production servers refuse it unless the operator set SPEED_MODE_ALLOWED."
        />
      </Group>

      <Group
        title="Blind schedule"
        icon="list"
        description="Edit any value; levels renumber themselves. Alt + ↑ / ↓ moves the focused level."
        id="setup-f-blindSchedule"
        actions={
          <>
            <span className="acr-setup-bulk">
              <DurationField path="__bulk" label="All levels" className="acr-setup-bulk__field" hint="" value={bulkSeconds} onChange={setBulkSeconds} />
              <Button size="sm" variant="ghost" disabled={!isNum(bulkSeconds) || bulkSeconds <= 0 || levels.length === 0} onClick={() => update((c) => ({ ...c, blindSchedule: setAllDurations(c.blindSchedule, bulkSeconds) }), { undoLabel: `Set every level to ${durationLabel(bulkSeconds)}` })}>
                Apply
              </Button>
            </span>
            <Button size="sm" icon="plus" disabled={levels.length >= CONFIG_LIMITS.MAX_BLIND_LEVELS} onClick={() => update((c) => ({ ...c, blindSchedule: appendLevel(c.blindSchedule, c.anteType, meta.anteFromLevel) }))}>
              Add level
            </Button>
          </>
        }
      >
        <div className="acr-setup-facts">
          <Fact label="Levels" value={formatCount(levels.length)} sub={`max ${CONFIG_LIMITS.MAX_BLIND_LEVELS}`} />
          <Fact label="Projected duration" icon="clock" value={proj ? durationLabel(proj.totalSeconds) : '—'} sub="Every level at its duration, breaks included (pauses not)" />
          <Fact label="Starting depth" value={depth !== null ? bbText(config.startingStack, levels[0]!.bigBlind) : '—'} sub={levels[0] ? `Level 1 · ${formatChips(levels[0].smallBlind)} / ${formatChips(levels[0].bigBlind)}` : 'No levels'} tone={depth !== null && depth < 20 ? 'warning' : 'default'} />
          <Fact label="Last level" value={lastLevel && isNum(lastLevel.bigBlind) ? `${formatChips(lastLevel.smallBlind)} / ${formatChips(lastLevel.bigBlind)}` : '—'} sub={lastLevel && isNum(lastLevel.bigBlind) ? `Starting stack = ${bbText(config.startingStack, lastLevel.bigBlind)}` : undefined} />
          {bigBlinds.length > 1 && (
            <div className="acr-setup-fact acr-setup-fact--chart">
              <span className="acr-setup-fact__label">Big blind by level</span>
              <Sparkline data={bigBlinds.map((b) => Math.log10(Math.max(1, b)))} width={180} height={40} tone="positive" label={`Big blind rising from ${formatChips(bigBlinds[0]!)} to ${formatChips(bigBlinds[bigBlinds.length - 1]!)} (log scale)`} />
            </div>
          )}
        </div>
        {depth !== null && depth < 20 && <Note tone="warning">Players start with fewer than 20 big blinds: expect a very fast, all-in heavy game.</Note>}
        {lastLevel && (proj?.levels.length ?? 0) > 0 && <Note>The last level never ends: blinds stay at its values until the tournament finishes.</Note>}
        <IssueList issues={scheduleIssues} label="Schedule problems" />
        <ScheduleEditor projection={proj} />
      </Group>
    </>
  );
}
