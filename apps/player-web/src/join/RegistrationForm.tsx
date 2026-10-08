import { useState } from 'react';
import type { FormEvent } from 'react';
import { newClientSeed } from '@jpb/client-sdk';
import type { JoinInfoDto, RegisterResponse } from '@jpb/shared-types';
import { Alert, Button, Icon, TextField } from '@jpb/ui';
import { friendlyError } from '../api/errors';
import type { FriendlyError } from '../api/errors';
import { useBackend } from '../app/backend';
import { FIELD_META, cleanRegistration, fieldLabel, validateRegistration } from './registrationFields';

export interface RegistrationFormProps {
  info: JoinInfoDto;
  onRegistered: (res: RegisterResponse) => void;
  onCancel: () => void;
}

/** Built from the organiser's field config (JoinInfoDto.registration.fields). */
export function RegistrationForm({ info, onRegistered, onCancel }: RegistrationFormProps) {
  const { api } = useBackend();
  const fields = info.registration.fields;
  const [values, setValues] = useState<Record<string, string>>({});
  const [accessCode, setAccessCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<FriendlyError | null>(null);
  const [busy, setBusy] = useState(false);
  const requiresAccess = info.registration.requiresAccessCode;

  const set = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateRegistration(fields, values, { required: requiresAccess, code: accessCode });
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = Object.keys(found)[0];
      document.getElementById(`reg-${first}`)?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const res = await api.register(info.joinCode, {
        fields: cleanRegistration(fields, values),
        accessCode: requiresAccess ? accessCode.trim() : null,
        // The browser's contribution to the tournament's public entropy (fairness).
        clientSeed: newClientSeed(),
      });
      onRegistered(res);
    } catch (err) {
      const f = friendlyError(err);
      setFailure(f);
      if (Object.keys(f.fields).length > 0) setErrors(f.fields);
      if (f.code === 'ACCESS_CODE_INVALID') setErrors((prev) => ({ ...prev, accessCode: 'That code was not accepted.' }));
      setBusy(false);
    }
  };

  return (
    <form className="pw-form" onSubmit={onSubmit} noValidate aria-busy={busy || undefined} aria-labelledby="reg-title">
      <div className="pw-form__head">
        <p className="pw-eyebrow">Join tournament</p>
        <h1 id="reg-title" className="pw-form__title">
          {info.name}
        </h1>
      </div>
      {failure && (
        <Alert severity="CRITICAL" title={failure.title}>
          {failure.message}
        </Alert>
      )}
      {fields.map((f) => {
        const meta = FIELD_META[f.key];
        return (
          <TextField
            key={f.key}
            id={`reg-${f.key}`}
            label={fieldLabel(f)}
            type={meta.type}
            inputMode={meta.inputMode}
            autoComplete={meta.autoComplete}
            maxLength={meta.maxLength}
            required={f.required}
            hint={f.required ? meta.hint : (meta.hint ?? 'Optional')}
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            error={errors[f.key] || undefined}
          />
        );
      })}
      {requiresAccess && (
        <TextField
          id="reg-accessCode"
          label="Venue access code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          hint="Printed at the venue or given by the organiser."
          value={accessCode}
          onChange={(e) => {
            setAccessCode(e.target.value);
            if (errors.accessCode) setErrors((prev) => ({ ...prev, accessCode: '' }));
          }}
          error={errors.accessCode || undefined}
        />
      )}
      <p className="pw-privacy">
        <Icon name="shield" />
        <span>
          We only ask what the organiser needs to run this event. Other players see your nickname (or name) and player ID — nothing else. Your details are visible to tournament staff only.
        </span>
      </p>
      <Button type="submit" variant="primary" size="xl" block loading={busy} loadingLabel="Registering…">
        Register
      </Button>
      <Button type="button" variant="ghost" size="lg" block onClick={onCancel} disabled={busy}>
        Back
      </Button>
    </form>
  );
}
