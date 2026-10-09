import { useId } from 'react';
import type { ReactNode } from 'react';
import { Icon, cx } from '@jpb/ui';

export interface RadioCardOption<V extends string> {
  value: V;
  title: ReactNode;
  text?: ReactNode;
  /** Machine value shown as a code chip (e.g. "BB_ANTE"). */
  code?: string;
}

export interface RadioCardsProps<V extends string> {
  /** Accessible group name (visually hidden legend). */
  legend: string;
  value: V;
  options: ReadonlyArray<RadioCardOption<V>>;
  onChange: (value: V) => void;
  /** DOM id of the group (issue links focus it). */
  id?: string;
  disabled?: boolean;
  columns?: 2 | 3;
  className?: string;
}

/** Native radio buttons styled as cards: arrow keys, Space and screen readers work as usual. */
export function RadioCards<V extends string>({ legend, value, options, onChange, id, disabled, columns = 2, className }: RadioCardsProps<V>) {
  const name = useId();
  return (
    <fieldset className={cx('acr-setup-radio', `acr-setup-radio--${columns}`, className)} id={id} tabIndex={id ? -1 : undefined} disabled={disabled}>
      <legend className="jpb-sr-only">{legend}</legend>
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <label key={o.value} className={cx('acr-setup-radio__item', checked && 'is-active')}>
            <input type="radio" className="acr-setup-radio__input" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} />
            <span className="acr-setup-radio__mark" aria-hidden="true">
              {checked && <Icon name="dot" />}
            </span>
            <span className="acr-setup-radio__body">
              <span className="acr-setup-radio__title">
                {o.title}
                {o.code && <span className="acr-setup-radio__code jpb-mono">{o.code}</span>}
              </span>
              {o.text && <span className="acr-setup-radio__text">{o.text}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
