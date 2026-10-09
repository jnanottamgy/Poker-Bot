import type { TimingConfig } from '@jpb/shared-types';
import { Badge, Toggle } from '@jpb/ui';
import { CONFIG_LIMITS, presetTiming } from '@jpb/validation';
import { useWizard } from '../components/context';
import { NumberField } from '../components/fields';
import { Fact, Group, Note } from '../components/Group';
import { durationLabel, isNum } from '../model/format';

const MS_PER_SECOND = 1000;

/** Step 5 — action / away timers, network grace, delays between hands and the start countdown. */
export function TimingStep() {
  const { config, update } = useWizard();
  const t = config.timing;
  const set = (patch: Partial<TimingConfig>) => update((c) => ({ ...c, timing: { ...c.timing, ...patch } }));
  const standard = presetTiming('STANDARD');
  const minTimer = config.speedMode ? CONFIG_LIMITS.MIN_ACTION_TIMER_SECONDS : CONFIG_LIMITS.MIN_ACTION_TIMER_SECONDS_NORMAL;
  const hardCutoff = isNum(t.actionTimerSeconds) && isNum(t.actionGraceMs) ? t.actionTimerSeconds * MS_PER_SECOND + t.actionGraceMs : null;

  return (
    <>
      <Group title="Action timers" icon="clock" description="Server-authoritative: the countdown players see is the server's deadline, never the phone's clock.">
        <div className="acr-setup-grid acr-setup-grid--3">
          <NumberField path="timing.actionTimerSeconds" label="Action timer" required suffix="s" value={t.actionTimerSeconds} onChange={(v) => set({ actionTimerSeconds: v })} hint={`${minTimer}–${CONFIG_LIMITS.MAX_ACTION_TIMER_SECONDS} s per decision`} />
          <NumberField
            path="timing.awayActionTimerSeconds"
            label="Away action timer"
            required
            suffix="s"
            value={t.awayActionTimerSeconds}
            onChange={(v) => set({ awayActionTimerSeconds: v })}
            hint="Shorter timer for disconnected / away players; at most the action timer"
          />
          <NumberField path="timing.awayAfterTimeouts" label="Timeouts before away" required value={t.awayAfterTimeouts} onChange={(v) => set({ awayAfterTimeouts: v })} hint={`Consecutive timeouts (1–${CONFIG_LIMITS.MAX_AWAY_AFTER_TIMEOUTS})`} />
        </div>
        <div className="acr-setup-grid acr-setup-grid--3">
          <NumberField
            path="timing.actionGraceMs"
            label="Network grace"
            required
            decimals
            scale={MS_PER_SECOND}
            suffix="s"
            value={t.actionGraceMs}
            onChange={(v) => set({ actionGraceMs: v })}
            hint={`Added to every deadline (0–${CONFIG_LIMITS.MAX_ACTION_GRACE_MS / MS_PER_SECOND} s) so a last-second tap is not lost to latency`}
          />
          <div className="acr-setup-readonly acr-setup-readonly--field">
            <span className="acr-setup-readonly__label">On timeout</span>
            <span className="acr-setup-readonly__value">Check if possible, otherwise fold</span>
            <Badge>CHECK_ELSE_FOLD</Badge>
          </div>
        </div>
        <div className="acr-setup-facts">
          <Fact label="Hard cutoff per action" value={hardCutoff !== null ? `${(hardCutoff / MS_PER_SECOND).toLocaleString('en-US')} s` : '—'} sub="Timer + grace; after it the server acts for the player" />
          <Fact label="Away after" value={isNum(t.awayAfterTimeouts) ? `${t.awayAfterTimeouts} timeout${t.awayAfterTimeouts === 1 ? '' : 's'}` : '—'} sub={isNum(t.awayActionTimerSeconds) ? `then ${t.awayActionTimerSeconds} s per decision until they act` : undefined} />
          <Fact label="Standard preset" value={`${standard.actionTimerSeconds} s / ${standard.awayActionTimerSeconds} s`} sub="Action / away timer" />
        </div>
        {isNum(t.actionTimerSeconds) && t.actionTimerSeconds < CONFIG_LIMITS.MIN_ACTION_TIMER_SECONDS_NORMAL && config.speedMode && <Note tone="warning">Timers under {CONFIG_LIMITS.MIN_ACTION_TIMER_SECONDS_NORMAL} s are only allowed in speed mode — humans on phones cannot keep up.</Note>}
      </Group>

      <Group title="Pacing" icon="activity" description="Short pauses that let phones animate chips, cards and showdowns between hands.">
        <div className="acr-setup-grid acr-setup-grid--3">
          <NumberField path="timing.betweenHandsDelayMs" label="Delay between hands" required decimals scale={MS_PER_SECOND} suffix="s" value={t.betweenHandsDelayMs} onChange={(v) => set({ betweenHandsDelayMs: v })} hint={`0–${CONFIG_LIMITS.MAX_BETWEEN_HANDS_DELAY_MS / MS_PER_SECOND} s`} />
          <NumberField path="timing.showdownDelayMs" label="Extra showdown delay" required decimals scale={MS_PER_SECOND} suffix="s" value={t.showdownDelayMs} onChange={(v) => set({ showdownDelayMs: v })} hint="Added after a showdown so everyone sees the cards" />
          <NumberField
            path="timing.startCountdownSeconds"
            label="Start countdown"
            required
            suffix="s"
            value={t.startCountdownSeconds}
            onChange={(v) => set({ startCountdownSeconds: v })}
            hint={isNum(t.startCountdownSeconds) ? `First deal ${durationLabel(t.startCountdownSeconds)} after seats are announced` : 'Before the first deal'}
          />
        </div>
      </Group>

      <Group title="Bubble" icon="trophy" description="Hand-for-hand keeps every table in step so nobody can stall into the money.">
        <Toggle
          id="setup-f-handForHand-autoAtBubble"
          checked={config.handForHand.autoAtBubble}
          onChange={(v) => update((c) => ({ ...c, handForHand: { autoAtBubble: v } }))}
          label="Hand-for-hand automatically at the bubble"
          description={`Starts when the players left equal the paid places + 1 (${config.prizeStructure.places.length + 1} with this prize table). The director can also switch it from Clock & Structure.`}
        />
      </Group>
    </>
  );
}
