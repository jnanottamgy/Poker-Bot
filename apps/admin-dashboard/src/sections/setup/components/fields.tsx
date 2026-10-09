import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Icon, TextField, cx } from '@jpb/ui';
import { dateTimeLocalText, durationText, isNum, localTimeZone, moneyText, numberText, parseDateTimeLocal, parseDurationText, parseMoneyText, parseNumberText } from '../model/format';
import { fieldDomId } from '../model/issues';
import { useWizard } from './context';

/**
 * Inputs bound to one configuration path: the DOM id comes from the path (so
 * an issue can focus it) and the first validation issue at that path is the
 * field's error (aria-invalid + described-by, icon + text).
 */

/** Id + error text for the control editing `path`. */
export function useFieldIssue(path: string): { id: string; error: string | undefined } {
  const { issuesAt } = useWizard();
  return { id: fieldDomId(path), error: issuesAt(path)[0]?.message };
}

const same = (a: number | null, b: number | null) => Object.is(a, b) || (a !== null && b !== null && !isNum(a) && !isNum(b));

/**
 * Keeps what the operator typed while committing the parsed value on every
 * keystroke; shows the canonical text on blur and whenever the value changes
 * from elsewhere (preset, undo, restore).
 */
export function useTextBinding(value: number | null, format: (v: number | null) => string, parse: (t: string) => number | null, commit: (v: number | null) => void, pretty: (v: number | null) => string = format) {
  const [text, setText] = useState(() => pretty(value));
  const focused = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    if (!same(parse(textRef.current), value)) setText(focused.current ? format(value) : pretty(value));
    // Only an outside change of the value re-syncs the text (parse/format are stable per field).
  }, [value]);
  return {
    value: text,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setText(e.target.value);
      commit(parse(e.target.value));
    },
    onFocus: () => {
      focused.current = true;
      if (pretty !== format && same(parse(textRef.current), value)) setText(format(value));
    },
    onBlur: () => {
      focused.current = false;
      if (same(parse(textRef.current), value)) setText(pretty(value));
    },
  };
}

interface BaseProps {
  path: string;
  label: ReactNode;
  hint?: ReactNode;
  suffix?: ReactNode;
  required?: boolean;
  className?: string;
  placeholder?: string;
}

export interface NumberFieldProps extends BaseProps {
  value: number;
  onChange: (value: number) => void;
  /** Stored value = typed value × scale (e.g. 1000 to type seconds and store ms). */
  scale?: number;
  decimals?: boolean;
  /** Thousands separators when not focused (chips). */
  grouping?: boolean;
}

export function NumberField({ path, label, hint, suffix, required, className, placeholder, value, onChange, scale, decimals, grouping }: NumberFieldProps) {
  const { readOnly } = useWizard();
  const { id, error } = useFieldIssue(path);
  const bind = useTextBinding(
    value,
    (v) => numberText(v, { scale }),
    (t) => parseNumberText(t, { scale, decimals }),
    (v) => onChange(v ?? Number.NaN),
    (v) => numberText(v, { scale, grouping }),
  );
  return (
    <TextField
      id={id}
      label={label}
      hint={hint}
      error={error}
      suffix={suffix}
      required={required}
      className={cx('acr-setup-field', className)}
      inputMode={decimals ? 'decimal' : 'numeric'}
      autoComplete="off"
      placeholder={placeholder}
      disabled={readOnly}
      {...bind}
    />
  );
}

export interface DurationFieldProps extends BaseProps {
  /** Seconds. */
  value: number;
  onChange: (seconds: number) => void;
}

/** Minutes ("8"), m:ss ("0:30"), "45s", "1.5m" or "2h"; stores whole seconds. */
export function DurationField({ path, label, hint, required, className, value, onChange }: DurationFieldProps) {
  const { readOnly } = useWizard();
  const { id, error } = useFieldIssue(path);
  const bind = useTextBinding(value, durationText, parseDurationText, (v) => onChange(v ?? Number.NaN));
  return (
    <TextField
      id={id}
      label={label}
      hint={hint ?? 'Minutes, m:ss or e.g. 45s'}
      error={error}
      suffix="min"
      required={required}
      className={cx('acr-setup-field', className)}
      inputMode="text"
      autoComplete="off"
      disabled={readOnly}
      {...bind}
    />
  );
}

export interface MoneyFieldProps extends BaseProps {
  /** Integer minor units. */
  value: number;
  currency: string;
  onChange: (minor: number) => void;
}

/** Money typed in major units (exact conversion to integer minor units). */
export function MoneyField({ path, label, hint, required, className, value, currency, onChange, placeholder }: MoneyFieldProps) {
  const { readOnly } = useWizard();
  const { id, error } = useFieldIssue(path);
  const bind = useTextBinding(
    value,
    (v) => moneyText(v, currency),
    (t) => parseMoneyText(t, currency),
    (v) => onChange(v ?? Number.NaN),
    (v) => moneyText(v, currency, true),
  );
  return (
    <TextField
      id={id}
      label={label}
      hint={hint}
      error={error}
      suffix={currency}
      required={required}
      className={cx('acr-setup-field', className)}
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      disabled={readOnly}
      {...bind}
    />
  );
}

export interface DateTimeFieldProps extends BaseProps {
  value: number | null;
  onChange: (epochMs: number | null) => void;
}

/** <input type="datetime-local"> in the browser's time zone; empty = not set. */
export function DateTimeField({ path, label, hint, className, value, onChange }: DateTimeFieldProps) {
  const { readOnly } = useWizard();
  const { id, error } = useFieldIssue(path);
  const [text, setText] = useState(() => dateTimeLocalText(value));
  useEffect(() => {
    const parsed = parseDateTimeLocal(text);
    if (!(parsed === value || (parsed !== null && value !== null && !isNum(parsed) && !isNum(value)))) setText(dateTimeLocalText(value));
  }, [value]);
  return (
    <div className={cx('acr-setup-datetime', className)}>
      <TextField
        id={id}
        type="datetime-local"
        label={label}
        hint={hint ?? `Your time zone: ${localTimeZone()}`}
        error={error}
        disabled={readOnly}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseDateTimeLocal(e.target.value));
        }}
      />
      {value !== null && !readOnly && (
        <button
          type="button"
          className="acr-setup-linkbtn acr-setup-datetime__clear"
          onClick={() => {
            setText('');
            onChange(null);
          }}
        >
          <Icon name="x" /> Clear
        </button>
      )}
    </div>
  );
}

export interface CellInputProps {
  path: string;
  /** Accessible name, e.g. "Level 3 big blind". */
  label: string;
  value: number;
  onChange: (value: number) => void;
  kind?: 'int' | 'duration' | 'money';
  currency?: string;
  className?: string;
}

/** Compact input for virtualized editor rows; the error is announced and shown under it. */
export function CellInput({ path, label, value, onChange, kind = 'int', currency = 'INR', className }: CellInputProps) {
  const { readOnly } = useWizard();
  const { id, error } = useFieldIssue(path);
  const fmt = kind === 'duration' ? durationText : kind === 'money' ? (v: number | null) => moneyText(v, currency) : (v: number | null) => numberText(v);
  const pretty = kind === 'money' ? (v: number | null) => moneyText(v, currency, true) : kind === 'int' ? (v: number | null) => numberText(v, { grouping: true }) : fmt;
  const parse = kind === 'duration' ? parseDurationText : kind === 'money' ? (t: string) => parseMoneyText(t, currency) : (t: string) => parseNumberText(t);
  const bind = useTextBinding(value, fmt, parse, (v) => onChange(v ?? Number.NaN), pretty);
  return (
    <span className={cx('acr-setup-cell', error && 'is-invalid', className)}>
      <input
        id={id}
        className="jpb-input acr-setup-cell__input jpb-num"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        inputMode={kind === 'int' ? 'numeric' : kind === 'money' ? 'decimal' : 'text'}
        autoComplete="off"
        disabled={readOnly}
        {...bind}
      />
      {error && (
        <span id={`${id}-err`} className="acr-setup-cell__err" title={error}>
          <Icon name="warning" /> {error}
        </span>
      )}
    </span>
  );
}

/** Problems reported on a whole group (e.g. "registration.fields"), shown above it. */
export function GroupIssues({ path, className }: { path: string; className?: string }) {
  const { issuesAt } = useWizard();
  const issues = issuesAt(path);
  if (issues.length === 0) return null;
  return (
    <ul className={cx('acr-setup-groupissues', className)} id={`${fieldDomId(path)}-issues`}>
      {issues.map((i) => (
        <li key={i.key}>
          <Icon name="warning" /> {i.message}
        </li>
      ))}
    </ul>
  );
}
