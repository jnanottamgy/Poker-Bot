import { cx } from '../cx';

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  tone?: 'positive' | 'info' | 'warning' | 'danger' | 'gold' | 'neutral';
  /** Fill the area under the line (very subtle). */
  area?: boolean;
  /** Accessible summary, e.g. "Players remaining, falling from 2,000 to 184". Omit to hide from AT. */
  label?: string;
  className?: string;
}

/** Tiny inline SVG trend line. Scales to min/max of the data; flat data draws a centered line. */
export function Sparkline({ data, width = 96, height = 28, tone = 'info', area = true, label, className }: SparklineProps) {
  const pad = 2;
  const pts = data.length === 1 ? [data[0] ?? 0, data[0] ?? 0] : data;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = pts.length > 1 ? (width - pad * 2) / (pts.length - 1) : 0;
  const coords = pts.map((v, i) => {
    const x = pad + i * step;
    const y = max === min ? height / 2 : pad + (1 - (v - min) / span) * (height - pad * 2);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const last = coords[coords.length - 1];
  const fill = `${line} L${last ? last[0] : 0} ${height} L${pad} ${height} Z`;
  if (pts.length === 0) return null;
  return (
    <svg
      className={cx('jpb-spark', `jpb-spark--${tone}`, className)}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      preserveAspectRatio="none"
    >
      {area && <path d={fill} className="jpb-spark__area" />}
      <path d={line} className="jpb-spark__line" />
      {last && <circle cx={last[0]} cy={last[1]} r={2.25} className="jpb-spark__dot" />}
    </svg>
  );
}
