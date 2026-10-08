import type { CSSProperties } from 'react';
import { cx } from '../cx';

export interface SkeletonProps {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  shape?: 'line' | 'block' | 'circle';
  /** Repeats `line` skeletons. */
  lines?: number;
  className?: string;
}

/** Loading placeholder. Hidden from assistive tech; pair with a status label on the container. */
export function Skeleton({ width, height, shape = 'line', lines = 1, className }: SkeletonProps) {
  if (shape === 'line' && lines > 1) {
    return (
      <span className={cx('jpb-skeleton-stack', className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="jpb-skeleton jpb-skeleton--line" style={{ width: i === lines - 1 ? '60%' : width }} />
        ))}
      </span>
    );
  }
  return <span className={cx('jpb-skeleton', `jpb-skeleton--${shape}`, className)} style={{ width, height }} aria-hidden="true" />;
}
