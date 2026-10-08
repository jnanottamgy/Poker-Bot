import type { ReactNode } from 'react';
import { cx } from '../cx';
import type { Tone } from './StatusPill';

export interface ProgressBarProps {
  /** 0..max */
  value: number;
  max?: number;
  label: ReactNode;
  /** Text shown on the right, e.g. "184 / 2,000". Defaults to a percentage. */
  valueText?: string;
  tone?: Tone;
  className?: string;
}

/** Labelled determinate progress (role="progressbar" with aria-valuetext). */
export function ProgressBar({ value, max = 100, label, valueText, tone = 'positive', className }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const text = valueText ?? `${Math.round(pct)}%`;
  return (
    <div className={cx('jpb-progress', `jpb-progress--${tone}`, className)}>
      <div className="jpb-progress__head">
        <span className="jpb-progress__label">{label}</span>
        <span className="jpb-progress__value">{text}</span>
      </div>
      <div
        className="jpb-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        aria-label={typeof label === 'string' ? label : undefined}
      >
        <span className="jpb-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
