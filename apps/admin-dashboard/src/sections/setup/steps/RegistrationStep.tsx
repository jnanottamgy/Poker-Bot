import type { RegistrationFieldConfig, RegistrationFieldKey, TournamentConfig } from '@jpb/shared-types';
import { Button, TextField, Toggle, cx, formatChips } from '@jpb/ui';
import { CONFIG_LIMITS, REGISTRATION_FIELD_KEYS, REGISTRATION_FIELD_LABELS } from '@jpb/validation';
import { useWizard } from '../components/context';
import { DateTimeField, GroupIssues, NumberField, useFieldIssue } from '../components/fields';
import { Group, Note } from '../components/Group';
import { projection as projectLevels } from '../model/blinds';
import { newAccessCode } from '../model/draft';
import { durationLabel, isNum } from '../model/format';
import { fieldDomId } from '../model/issues';

/** Level a newly enabled late-registration / re-entry window ends at (capped by the schedule). */
const DEFAULT_WINDOW_LEVEL = 6;
const MIN_REENTRY_ENTRIES = 2;

const FIELD_HINT: Readonly<Record<RegistrationFieldKey, string>> = {
  name: 'Always collected: shown at tables unless a nickname is given',
  nickname: 'Shown at tables instead of the name',
  participantId: 'Your event’s badge or ticket number',
  email: 'Private: visible to staff with PII access only',
  phone: 'Private: visible to staff with PII access only',
  collegeId: 'Private: student / staff id for campus events',
};

/** Fields in display order; switching one on inserts it at its canonical position. */
function setFieldOn(fields: readonly RegistrationFieldConfig[], key: RegistrationFieldKey, on: boolean): RegistrationFieldConfig[] {
  if (!on) return fields.filter((f) => f.key !== key);
  if (fields.some((f) => f.key === key)) return [...fields];
  const order = (k: RegistrationFieldKey) => REGISTRATION_FIELD_KEYS.indexOf(k);
  return [...fields, { key, required: false }].sort((a, b) => order(a.key) - order(b.key));
}

function patchField(fields: readonly RegistrationFieldConfig[], key: RegistrationFieldKey, patch: Partial<RegistrationFieldConfig>): RegistrationFieldConfig[] {
  const present = fields.some((f) => f.key === key);
  const base = present ? fields : setFieldOn(fields, key, true);
  return base.map((f) => {
    if (f.key !== key) return f;
    const next = { ...f, ...patch };
    if (next.label === undefined || next.label === '') delete next.label;
    return next;
  });
}

function windowLevel(config: TournamentConfig): number {
  return Math.max(1, Math.min(DEFAULT_WINDOW_LEVEL, config.blindSchedule.length));
}

function FieldRow({ fieldKey }: { fieldKey: RegistrationFieldKey }) {
  const { config, update, readOnly } = useWizard();
  const fields = config.registration.fields;
  const index = fields.findIndex((f) => f.key === fieldKey);
  const field = index >= 0 ? fields[index]! : null;
  const isName = fieldKey === 'name';
  const on = isName || field !== null;
  const required = isName && field === null ? true : (field?.required ?? false);
  const reqIssue = useFieldIssue(`registration.fields[${index}].required`);
  const labelIssue = useFieldIssue(`registration.fields[${index}].label`);
  const keyIssue = useFieldIssue(`registration.fields[${index}].key`);
  const setFields = (fn: (f: RegistrationFieldConfig[]) => RegistrationFieldConfig[]) => update((c) => ({ ...c, registration: { ...c.registration, fields: fn(c.registration.fields) } }));
  const label = REGISTRATION_FIELD_LABELS[fieldKey];
  const error = reqIssue.error ?? keyIssue.error;

  return (
    <li className={cx('acr-setup-regfield', on && 'is-on', error && 'is-invalid')}>
      <div className="acr-setup-regfield__main">
        {isName ? (
          <span className="acr-setup-regfield__always">
            <strong>{label}</strong>
            <span className="acr-setup-dim">Always collected</span>
          </span>
        ) : (
          <Toggle id={fieldDomId(`registration.fields.${fieldKey}`)} checked={on} disabled={readOnly} onChange={(v) => setFields((f) => setFieldOn(f, fieldKey, v))} label={label} description={FIELD_HINT[fieldKey]} />
        )}
        {isName && <span className="acr-setup-regfield__hint">{FIELD_HINT.name}</span>}
      </div>
      <label className={cx('acr-setup-check', !on && 'is-disabled')}>
        <input
          id={index >= 0 ? reqIssue.id : undefined}
          type="checkbox"
          checked={on && required}
          disabled={!on || readOnly}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setFields((f) => patchField(f, fieldKey, { required: e.target.checked }))}
        />
        Required
      </label>
      <TextField
        id={index >= 0 ? labelIssue.id : undefined}
        label={`${label} label`}
        hideLabel
        placeholder={`Label (default “${label}”)`}
        value={field?.label ?? ''}
        error={labelIssue.error}
        disabled={!on || readOnly}
        maxLength={CONFIG_LIMITS.FIELD_LABEL_MAX_LENGTH * 2}
        className="acr-setup-regfield__label"
        onChange={(e) => setFields((f) => patchField(f, fieldKey, { label: e.target.value }))}
      />
      {error && <p className="acr-setup-regfield__err">{error}</p>}
    </li>
  );
}

/** Step 6 — registration form, approval, access code, deadline, late registration and re-entry. */
export function RegistrationStep() {
  const { config, update, readOnly } = useWizard();
  const reg = config.registration;
  const lr = config.lateRegistration;
  const re = config.reentry;
  const access = useFieldIssue('registration.accessCode');
  const proj = projectLevels(config.blindSchedule, config.breaks);
  const levelCount = config.blindSchedule.length;

  const levelText = (n: number): string | undefined => {
    if (!isNum(n) || n < 1 || n > levelCount) return undefined;
    const l = config.blindSchedule[n - 1]!;
    const ends = proj?.levels[n - 1]?.endsAtSeconds;
    return `Level ${n}: ${formatChips(l.smallBlind)} / ${formatChips(l.bigBlind)}${ends !== undefined && n < levelCount ? ` · ends about ${durationLabel(ends)} after the start` : ''}`;
  };
  const setReg = (patch: Partial<TournamentConfig['registration']>) => update((c) => ({ ...c, registration: { ...c.registration, ...patch } }));

  return (
    <>
      <Group title="Registration form" icon="user" description="What players fill in on the join page. Either the name or the nickname must be required so every player has a display name." id={fieldDomId('registration.fields')}>
        <GroupIssues path="registration.fields" />
        <ul className="acr-setup-regfields" aria-label="Registration form fields">
          {REGISTRATION_FIELD_KEYS.map((k) => (
            <FieldRow key={k} fieldKey={k} />
          ))}
        </ul>
      </Group>

      <Group title="Who may register" icon="lock" description="Keep strangers out of a venue event and review entries before they count.">
        <div className="acr-setup-grid acr-setup-grid--2">
          <Toggle
            id="setup-f-registration-requireApproval"
            checked={reg.requireApproval}
            onChange={(v) => setReg({ requireApproval: v })}
            label="Staff approve each registration"
            description="Entries wait in the Registration screen’s queue; only approved players are seated."
          />
          <div className="acr-setup-stack">
            <Toggle
              id="setup-f-registration-accessCode-on"
              checked={reg.accessCode !== null}
              onChange={(v) => setReg({ accessCode: v ? newAccessCode() : null })}
              label="Require a venue access code"
              description="Printed at the venue; checked case-insensitively."
            />
            {reg.accessCode !== null && (
              <div className="acr-setup-inline acr-setup-inline--end">
                <TextField
                  id={access.id}
                  label="Access code"
                  value={reg.accessCode}
                  error={access.error}
                  hint="4–32 letters, digits or “-”"
                  className="acr-setup-grow"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={readOnly}
                  onChange={(e) => setReg({ accessCode: e.target.value.toUpperCase().replace(/\s+/g, '') })}
                />
                <Button size="sm" variant="ghost" icon="refresh" disabled={readOnly} onClick={() => setReg({ accessCode: newAccessCode() })}>
                  New code
                </Button>
              </div>
            )}
          </div>
        </div>
      </Group>

      <Group title="Deadline & late registration" icon="clock" description="Registration closes at the deadline (or by hand). Late registration keeps it open after the start.">
        <div className="acr-setup-grid acr-setup-grid--2">
          <DateTimeField path="registrationDeadline" label="Registration deadline" value={config.registrationDeadline} onChange={(v) => update((c) => ({ ...c, registrationDeadline: v }))} />
          <div />
        </div>
        <div className="acr-setup-grid acr-setup-grid--2">
          <div className="acr-setup-stack">
            <Toggle
              id="setup-f-lateRegistration-enabled"
              checked={lr.enabled}
              onChange={(v) =>
                update((c) => ({
                  ...c,
                  lateRegistration: { enabled: v, untilLevel: v && c.lateRegistration.untilLevel < 1 ? windowLevel(c) : c.lateRegistration.untilLevel },
                  features: { ...c.features, lateRegistration: v },
                }))
              }
              label="Late registration"
              description="New players join with a full starting stack until the end of the chosen level."
            />
            {lr.enabled && (
              <NumberField
                path="lateRegistration.untilLevel"
                label="Open until the end of level"
                required
                value={lr.untilLevel}
                onChange={(v) => update((c) => ({ ...c, lateRegistration: { ...c.lateRegistration, untilLevel: v } }))}
                hint={levelText(lr.untilLevel) ?? `1–${levelCount}`}
              />
            )}
          </div>
          <div className="acr-setup-stack">
            <Toggle
              id="setup-f-reentry-enabled"
              checked={re.enabled}
              onChange={(v) =>
                update((c) => ({
                  ...c,
                  reentry: {
                    enabled: v,
                    maxEntriesPerPlayer: v ? Math.max(MIN_REENTRY_ENTRIES, isNum(c.reentry.maxEntriesPerPlayer) ? c.reentry.maxEntriesPerPlayer : MIN_REENTRY_ENTRIES) : c.reentry.maxEntriesPerPlayer,
                    untilLevel: v && c.reentry.untilLevel < 1 ? windowLevel(c) : c.reentry.untilLevel,
                  },
                }))
              }
              label="Re-entry"
              description="A busted player may buy back in with a fresh stack."
            />
            {re.enabled && (
              <div className="acr-setup-grid acr-setup-grid--2">
                <NumberField
                  path="reentry.maxEntriesPerPlayer"
                  label="Max entries per player"
                  required
                  value={re.maxEntriesPerPlayer}
                  onChange={(v) => update((c) => ({ ...c, reentry: { ...c.reentry, maxEntriesPerPlayer: v } }))}
                  hint={`Including the first (2–${CONFIG_LIMITS.MAX_ENTRIES_PER_PLAYER})`}
                />
                <NumberField
                  path="reentry.untilLevel"
                  label="Until the end of level"
                  required
                  value={re.untilLevel}
                  onChange={(v) => update((c) => ({ ...c, reentry: { ...c.reentry, untilLevel: v } }))}
                  hint={levelText(re.untilLevel) ?? `1–${levelCount}`}
                />
              </div>
            )}
          </div>
        </div>
        {lr.enabled && !config.features.lateRegistration && <Note tone="warning">The “Late registration” feature flag is off (Spectators &amp; features step): late registration will not open until it is on.</Note>}
        {config.startTime !== null && config.registrationDeadline !== null && config.registrationDeadline > config.startTime && <Note tone="warning">The deadline is after the scheduled start.</Note>}
      </Group>
    </>
  );
}
