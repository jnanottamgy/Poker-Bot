import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '@jpb/client-sdk';
import type { RegistrationFieldKey, TournamentConfig } from '@jpb/shared-types';
import { Button, Icon, Panel, TextField } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import type { ManualRegistrationResponse } from '../../api/types';
import { usePermission } from '../../auth/permissions';
import { useDangerousAction } from '../../danger/DangerProvider';
import { CredentialCard } from '../players/CredentialCard';
import { PrintPortal, usePrint } from '../players/print';
import { joinUrlFor } from '../players/qr';
import { FIELD_INPUT, FIELD_MAX_LENGTH, formFields } from './model';

/** Light client checks (the server re-validates and normalizes every field). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9][0-9 -]{5,18}[0-9]$/;

type Errors = Partial<Record<RegistrationFieldKey, string>>;

function validate(fields: ReturnType<typeof formFields>, values: Record<string, string>): Errors {
  const errors: Errors = {};
  for (const f of fields) {
    const v = (values[f.key] ?? '').trim();
    if (!v) {
      if (f.required) errors[f.key] = `${f.label} is required.`;
      continue;
    }
    if (/[<>]/.test(v)) errors[f.key] = `${f.label} contains characters that are not allowed.`;
    else if (f.key === 'email' && !EMAIL.test(v)) errors[f.key] = 'Enter a valid email address.';
    else if (f.key === 'phone' && !PHONE.test(v)) errors[f.key] = 'Enter a valid phone number.';
  }
  return errors;
}

/** Field errors the server returned with INVALID_FIELDS (`details: [{ field, message }]`). */
function serverFieldErrors(err: unknown): Errors | null {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return null;
  const out: Errors = {};
  for (const d of err.details as Array<{ field?: unknown; message?: unknown }>) {
    if (typeof d.field === 'string' && typeof d.message === 'string') out[d.field as RegistrationFieldKey] = d.message;
  }
  return Object.keys(out).length ? out : null;
}

/** The server also returns `rejoinUrl` (not yet in ManualRegistrationResponse — see README contract notes). */
function rejoinUrlOf(r: ManualRegistrationResponse): string | null {
  const url = (r as ManualRegistrationResponse & { rejoinUrl?: unknown }).rejoinUrl;
  return typeof url === 'string' && url ? url : null;
}

export interface ManualRegistrationProps {
  tournamentId: string;
  tournamentName: string;
  joinCode: string;
  config: TournamentConfig;
  /** Registration (or late registration) currently accepts players. */
  accepting: boolean;
  qr: { src: string | null; loading: boolean };
}

/**
 * §2.9 manual registration by staff: the tournament's own fields, one
 * confirmation, then the seat card (public id + one-time rejoin code + join
 * QR) ready to print and hand to the player. Staff registrations are
 * approved immediately and need no access code (server rule).
 */
export function ManualRegistration({ tournamentId, tournamentName, joinCode, config, accepting, qr }: ManualRegistrationProps) {
  const api = useApi();
  const danger = useDangerousAction();
  const canRegister = usePermission('PLAYER_APPROVE_REGISTRATION');
  const formId = useId();
  const fields = formFields(config);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [result, setResult] = useState<ManualRegistrationResponse | null>(null);
  const printer = usePrint();

  if (!canRegister) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validate(fields, values);
    setErrors(found);
    if (Object.keys(found).length) return;
    const clean = Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? '').trim()]).filter(([, v]) => v !== ''));
    const name = clean.nickname || clean.name || 'the player';
    void danger<ManualRegistrationResponse>({
      level: 1,
      endpoint: 'registrationManual',
      title: `Register ${name}`,
      summary: 'Staff registration: approved immediately, no access code needed.',
      consequences: ['Counts toward the maximum number of players', 'A rejoin code is shown once — print the card or hand it over', 'A MANUAL_REGISTRATION audit entry records your name'],
      confirmLabel: 'Register player',
      run: async () => {
        try {
          return await api.registration.manual(tournamentId, { fields: clean });
        } catch (err) {
          const fieldErrors = serverFieldErrors(err);
          if (fieldErrors) setErrors(fieldErrors);
          throw err;
        }
      },
      success: (r) => `${r.player.displayName} registered (${r.player.publicId})`,
      invalidate: [qk.tournament(tournamentId)],
      onSuccess: (r) => {
        setResult(r);
        setValues({});
        setErrors({});
      },
    });
  };

  const card = (variant: 'screen' | 'print') =>
    result && (
      <CredentialCard
        variant={variant}
        tournamentName={tournamentName}
        playerName={result.player.displayName}
        publicId={result.player.publicId}
        rejoinCode={result.rejoinCode}
        rejoinUrl={rejoinUrlOf(result)}
        joinUrl={joinUrlFor(joinCode)}
        qrSrc={qr.src}
        qrLoading={qr.loading}
        seat={result.player.tableNumber !== null ? `Table ${result.player.tableNumber}${result.player.seat !== null ? ` · seat ${result.player.seat + 1}` : ''}` : 'Seat assigned when play starts'}
      />
    );

  return (
    <Panel title="Manual registration" icon="plus" description="For players without a phone, or when staff register at the desk.">
      {result ? (
        <div className="acr-registration-result" role="status">
          <p className="acr-registration-result__ok">
            <Icon name="check-circle" /> Registered. Give this card to the player — the rejoin code is not shown again.
          </p>
          {card('screen')}
          <div className="acr-registration-result__actions">
            <Button size="sm" variant="primary" icon="file" onClick={printer.print}>
              Print seat card
            </Button>
            <Button size="sm" variant="secondary" icon="plus" onClick={() => setResult(null)}>
              Register another player
            </Button>
          </div>
          {printer.printing && <PrintPortal onDone={printer.done}>{card('print')}</PrintPortal>}
        </div>
      ) : (
        <form id={formId} className="acr-registration-form" onSubmit={submit} noValidate>
          {fields.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              required={f.required}
              type={FIELD_INPUT[f.key].type}
              inputMode={FIELD_INPUT[f.key].inputMode}
              autoComplete={FIELD_INPUT[f.key].autoComplete}
              maxLength={FIELD_MAX_LENGTH[f.key]}
              value={values[f.key] ?? ''}
              disabled={!accepting}
              error={errors[f.key]}
              hint={f.key === 'nickname' ? 'Shown at the table instead of the name when given.' : undefined}
              onChange={(e) => {
                const v = e.target.value;
                setValues((prev) => ({ ...prev, [f.key]: v }));
                if (errors[f.key]) setErrors((prev) => ({ ...prev, [f.key]: undefined }));
              }}
            />
          ))}
          {!accepting && (
            <p className="acr-registration-note">
              <Icon name="lock" /> Manual registration is possible while registration (or late registration) is open.
            </p>
          )}
          <Button type="submit" variant="primary" icon="plus" disabled={!accepting}>
            Register player…
          </Button>
        </form>
      )}
    </Panel>
  );
}
