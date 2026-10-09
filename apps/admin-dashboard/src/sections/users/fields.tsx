import { useId, useMemo, useState } from 'react';
import { Button, Icon, SearchInput, StatusPill, TOURNAMENT_STATUS_META, TextField, cx, formatCount, useToast } from '@jpb/ui';
import type { TournamentListItemDto } from '@jpb/shared-types';
import { PASSWORD_POLICY, generatePassword } from './model';

/* ------------------------------------------------------------------ password */

export interface PasswordFieldsProps {
  password: string;
  confirm: string;
  onChange: (next: { password: string; confirm: string }) => void;
  /** Show errors (after the first submit attempt). */
  showErrors: boolean;
  label?: string;
}

/** New password + confirmation with the policy checklist, show/hide, generate and copy. */
export function PasswordFields({ password, confirm, onChange, showErrors, label = 'Password' }: PasswordFieldsProps) {
  const toast = useToast();
  const [visible, setVisible] = useState(false);
  const longEnough = password.length >= PASSWORD_POLICY.minLength && password.length <= PASSWORD_POLICY.maxLength;
  const matches = password.length > 0 && password === confirm;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast.push({ tone: 'success', title: 'Password copied', description: 'Hand it over in person; it is never shown again after this dialog.' });
    } catch {
      toast.push({ tone: 'warning', title: 'Could not copy', description: 'Select the password and copy it manually.' });
    }
  };
  return (
    <div className="acr-users-pw">
      <TextField
        label={label}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        value={password}
        maxLength={PASSWORD_POLICY.maxLength}
        required
        error={showErrors && !longEnough ? `At least ${PASSWORD_POLICY.minLength} characters.` : undefined}
        onChange={(e) => onChange({ password: e.target.value, confirm })}
      />
      <TextField
        label="Repeat the password"
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        value={confirm}
        maxLength={PASSWORD_POLICY.maxLength}
        required
        error={showErrors && !matches ? 'The two passwords do not match.' : undefined}
        onChange={(e) => onChange({ password, confirm: e.target.value })}
      />
      <div className="acr-users-pw__tools">
        <Button
          size="sm"
          variant="secondary"
          icon="key"
          onClick={() => {
            const p = generatePassword();
            onChange({ password: p, confirm: p });
            setVisible(true);
          }}
        >
          Generate strong password
        </Button>
        <Button size="sm" variant="ghost" icon={visible ? 'lock' : 'eye'} aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          {visible ? 'Hide' : 'Show'}
        </Button>
        {password && (
          <Button size="sm" variant="ghost" icon="file" onClick={() => void copy()}>
            Copy
          </Button>
        )}
      </div>
      <ul className="acr-users-pw__rules" aria-label="Password policy">
        <li className={cx(longEnough ? 'is-ok' : 'is-todo')}>
          <Icon name={longEnough ? 'check-circle' : 'dot'} /> {PASSWORD_POLICY.minLength}–{PASSWORD_POLICY.maxLength} characters <span className="jpb-sr-only">{longEnough ? '(met)' : '(not met)'}</span>
        </li>
        <li className={cx(matches ? 'is-ok' : 'is-todo')}>
          <Icon name={matches ? 'check-circle' : 'dot'} /> Both entries match <span className="jpb-sr-only">{matches ? '(met)' : '(not met)'}</span>
        </li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ scope */

export interface ScopePickerProps {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  tournaments: readonly TournamentListItemDto[];
  loading: boolean;
  disabled?: boolean;
  error?: string | null;
}

/** "All tournaments" or a chosen set (searchable checklist). */
export function ScopePicker({ value, onChange, tournaments, loading, disabled = false, error }: ScopePickerProps) {
  const id = useId();
  const [q, setQ] = useState('');
  const chosen = useMemo(() => new Set(value ?? []), [value]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tournaments.filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.joinCode.toLowerCase().includes(needle));
  }, [tournaments, q]);
  const unknown = (value ?? []).filter((tid) => !tournaments.some((t) => t.id === tid));
  return (
    <fieldset className="acr-users-scope" disabled={disabled}>
      <legend className="jpb-field__label">Tournament scope</legend>
      <label className="acr-users-radio">
        <input type="radio" name={`${id}-scope`} checked={value === null} onChange={() => onChange(null)} />
        <span>
          <strong>All tournaments</strong>
          <span className="acr-users-dim">Every current and future tournament.</span>
        </span>
      </label>
      <label className="acr-users-radio">
        <input type="radio" name={`${id}-scope`} checked={value !== null} onChange={() => onChange(value ?? [])} />
        <span>
          <strong>Only selected tournaments</strong>
          <span className="acr-users-dim">The server refuses every other tournament for this admin.</span>
        </span>
      </label>
      {value !== null && (
        <div className="acr-users-scope__list">
          <SearchInput value={q} onChange={setQ} label="Find a tournament" placeholder="Tournament name or join code" />
          {loading ? (
            <p className="acr-users-dim">Loading tournaments…</p>
          ) : (
            <ul aria-label="Tournaments">
              {list.map((t) => (
                <li key={t.id}>
                  <label className="acr-users-check">
                    <input
                      type="checkbox"
                      checked={chosen.has(t.id)}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(t.id);
                        else next.delete(t.id);
                        onChange([...next]);
                      }}
                    />
                    <span className="acr-users-check__name">{t.name}</span>
                    <span className="jpb-mono acr-users-dim">{t.joinCode}</span>
                    <StatusPill size="sm" tone={TOURNAMENT_STATUS_META[t.status].tone} icon={TOURNAMENT_STATUS_META[t.status].icon} label={TOURNAMENT_STATUS_META[t.status].label} />
                  </label>
                </li>
              ))}
              {unknown.map((tid) => (
                <li key={tid}>
                  <label className="acr-users-check">
                    <input type="checkbox" checked onChange={() => onChange((value ?? []).filter((x) => x !== tid))} />
                    <span className="jpb-mono acr-users-check__name">{tid}</span>
                    <span className="acr-users-dim">not in the list</span>
                  </label>
                </li>
              ))}
              {list.length === 0 && unknown.length === 0 && <li className="acr-users-dim">No tournament matches.</li>}
            </ul>
          )}
          <p className={cx('acr-users-scope__count', error && 'is-error')} role={error ? 'alert' : undefined}>
            {error ? (
              <>
                <Icon name="warning" /> {error}
              </>
            ) : (
              `${formatCount(chosen.size)} selected`
            )}
          </p>
        </div>
      )}
    </fieldset>
  );
}
