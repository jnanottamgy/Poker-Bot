import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Sparkline } from './Sparkline';
import type { SparklineProps } from './Sparkline';

export interface StatDelta {
  /** Display text, e.g. "+12", "-4.2%". */
  text: string;
  direction: 'up' | 'down' | 'flat';
  /** Whether this direction is good news (sets tone). Default: up = good. */
  good?: boolean;
  /** Context, e.g. "vs 5 min ago". */
  context?: string;
}

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Unit or secondary value next to the main value. */
  unit?: ReactNode;
  delta?: StatDelta;
  spark?: number[];
  sparkTone?: SparklineProps['tone'];
  icon?: IconName;
  /** Status emphasis for the whole tile. */
  tone?: 'default' | 'warning' | 'danger' | 'gold' | 'positive';
  hint?: ReactNode;
  className?: string;
}

/** KPI tile: label, big value, delta with arrow + text (never color-only), optional sparkline. */
export function StatTile({ label, value, unit, delta, spark, sparkTone = 'info', icon, tone = 'default', hint, className }: StatTileProps) {
  const good = delta ? (delta.good ?? delta.direction === 'up') : true;
  return (
    <div className={cx('jpb-stat', `jpb-stat--${tone}`, className)}>
      <div className="jpb-stat__head">
        {icon && <Icon name={icon} className="jpb-stat__icon" />}
        <span className="jpb-stat__label">{label}</span>
      </div>
      <div className="jpb-stat__main">
        <span className="jpb-stat__value jpb-num">
          {value}
          {unit && <span className="jpb-stat__unit">{unit}</span>}
        </span>
        {spark && spark.length > 1 && <Sparkline data={spark} tone={sparkTone} width={88} height={30} />}
      </div>
      {(delta || hint) && (
        <div className="jpb-stat__foot">
          {delta && (
            <span className={cx('jpb-stat__delta', delta.direction === 'flat' ? 'is-flat' : good ? 'is-good' : 'is-bad')}>
              {delta.direction !== 'flat' && <Icon name={delta.direction === 'up' ? 'arrow-up' : 'arrow-down'} />}
              <span className="jpb-num">{delta.text}</span>
              {delta.context && <span className="jpb-stat__ctx">{delta.context}</span>}
            </span>
          )}
          {hint && <span className="jpb-stat__hint">{hint}</span>}
        </div>
      )}
    </div>
  );
}
