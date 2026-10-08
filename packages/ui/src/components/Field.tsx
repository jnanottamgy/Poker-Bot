import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';

interface FieldChrome {
  label: ReactNode;
  /** Helper text under the control (linked via aria-describedby). */
  hint?: ReactNode;
  /** Error text; sets aria-invalid and is announced with an icon + text. */
  error?: ReactNode;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
  required?: boolean;
  className?: string;
}

function FieldFrame({
  id,
  label,
  hint,
  error,
  hideLabel,
  required,
  className,
  children,
}: FieldChrome & { id: string; children: ReactNode }) {
  return (
    <div className={cx('jpb-field', error ? 'is-invalid' : null, className)}>
      <label htmlFor={id} className={cx('jpb-field__label', hideLabel && 'jpb-sr-only')}>
        {label}
        {required && (
          <span className="jpb-field__req">
            <span aria-hidden="true"> *</span>
            <span className="jpb-sr-only"> (required)</span>
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="jpb-field__error">
          <Icon name="warning" /> {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="jpb-field__hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function describedBy(id: string, hint: ReactNode, error: ReactNode): string | undefined {
  if (error) return `${id}-err`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export interface TextFieldProps extends FieldChrome, Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  /** Text/unit shown inside the field on the right (e.g. "chips"). */
  suffix?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, hideLabel, required, className, suffix, id: idProp, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} required={required} className={className}>
      <span className="jpb-input-wrap">
        <input
          ref={ref}
          id={id}
          className="jpb-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          required={required}
          {...rest}
        />
        {suffix && <span className="jpb-input__suffix">{suffix}</span>}
      </span>
    </FieldFrame>
  );
});

export interface TextAreaProps extends FieldChrome, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, hideLabel, required, className, id: idProp, rows = 3, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} required={required} className={className}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        className="jpb-input jpb-textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        required={required}
        {...rest}
      />
    </FieldFrame>
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends FieldChrome, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  options: SelectOption[];
  placeholder?: string;
}

/** Native <select> (best keyboard + mobile behavior), styled. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, hideLabel, required, className, options, placeholder, id: idProp, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} required={required} className={className}>
      <span className="jpb-select-wrap">
        <select
          ref={ref}
          id={id}
          className="jpb-input jpb-select"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          required={required}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" className="jpb-select__chevron" />
      </span>
    </FieldFrame>
  );
});

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  /** Accessible label (visually the placeholder carries it). */
  label?: string;
  /** Result count announced politely, e.g. "12 players". */
  resultSummary?: string;
}

export function SearchInput({ value, onChange, label = 'Search', resultSummary, className, placeholder, ...rest }: SearchInputProps) {
  return (
    <div className={cx('jpb-search', className)} role="search">
      <Icon name="search" className="jpb-search__icon" />
      <input
        type="search"
        className="jpb-input jpb-search__input"
        aria-label={label}
        placeholder={placeholder ?? `${label}…`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            onChange('');
          }
        }}
        {...rest}
      />
      {value && (
        <button type="button" className="jpb-search__clear" aria-label="Clear search" onClick={() => onChange('')}>
          <Icon name="x" />
        </button>
      )}
      {resultSummary !== undefined && (
        <span className="jpb-sr-only" aria-live="polite">
          {resultSummary}
        </span>
      )}
    </div>
  );
}

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Visible ON/OFF text next to the switch (default true) — state is never color-only. */
  showState?: boolean;
  className?: string;
  id?: string;
}

/** Switch (role="switch"). Whole row is clickable; Space/Enter toggle. */
export function Toggle({ checked, onChange, label, description, disabled, showState = true, className, id: idProp }: ToggleProps) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={cx('jpb-toggle', disabled && 'is-disabled', className)}>
      <span className="jpb-toggle__text">
        <label htmlFor={id} className="jpb-toggle__label">
          {label}
        </label>
        {description && (
          <span id={`${id}-desc`} className="jpb-toggle__desc">
            {description}
          </span>
        )}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        className="jpb-toggle__switch"
        onClick={() => onChange(!checked)}
      >
        <span className="jpb-toggle__thumb" aria-hidden="true" />
      </button>
      {showState && (
        <span className="jpb-toggle__state" aria-hidden="true">
          {checked ? 'ON' : 'OFF'}
        </span>
      )}
    </div>
  );
}
