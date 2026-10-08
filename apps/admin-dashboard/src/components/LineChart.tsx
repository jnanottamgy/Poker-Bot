import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { cx } from '@jpb/ui';
import { formatTimeOfDay } from '../lib/time';
import { useElementWidth } from './useElementWidth';

export interface ChartSeries {
  id: string;
  label: string;
  values: number[];
  /** Series slot (CSS `--acr-series-N`), assigned in fixed order — never by rank. */
  slot?: 1 | 2 | 3;
  /** Secondary encoding so identity is never colour alone. */
  dash?: 'solid' | 'dashed' | 'dotted';
}

export interface LineChartProps {
  /** Accessible chart name, e.g. "Players remaining over the last 2 hours". */
  label: string;
  /** X values (server epoch ms), same length as every series. */
  x: number[];
  series: ChartSeries[];
  height?: number;
  formatValue?: (v: number) => string;
  /** Start the y axis at zero (default true for counts). */
  zeroBased?: boolean;
  /** Unit suffix in the tooltip, e.g. "ms". */
  unit?: string;
  className?: string;
}

const PAD = { top: 10, bottom: 24, left: 46 };
const DASH: Record<NonNullable<ChartSeries['dash']>, string | undefined> = { solid: undefined, dashed: '6 4', dotted: '1.5 4' };

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/**
 * Small time-series line chart in inline SVG: recessive grid, 2px lines,
 * direct end labels + legend when there are several series, crosshair and
 * tooltip on hover or arrow keys, and a data-table view.
 */
export function LineChart({ label, x, series, height = 168, formatValue = (v) => v.toLocaleString('en-US'), zeroBased = true, unit, className }: LineChartProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const multi = series.length > 1;
  const padRight = multi ? 52 : 14;
  const plotW = Math.max(40, width - PAD.left - padRight);
  const plotH = height - PAD.top - PAD.bottom;

  const { yMin, yMax, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    const lo = all.length ? Math.min(...all) : 0;
    const hi = all.length ? Math.max(...all) : 1;
    const t = niceTicks(zeroBased ? Math.min(0, lo) : lo, hi === lo ? hi + 1 : hi);
    return { yMin: t[0]!, yMax: t[t.length - 1]!, ticks: t };
  }, [series, zeroBased]);

  const n = x.length;
  const px = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const py = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const xTicks = n > 1 ? [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1] : [0];

  const pickIndex = (clientX: number, rect: DOMRect) => {
    const rel = clientX - rect.left - PAD.left;
    return Math.max(0, Math.min(n - 1, Math.round((rel / plotW) * (n - 1))));
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => n && setHover(pickIndex(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!n) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
    } else if (e.key === 'Escape') setHover(null);
  };

  const last = n - 1;
  const summary = series.map((s) => `${s.label} ${s.values.length ? formatValue(s.values[last]!) : 'no data'}${unit ? ` ${unit}` : ''}`).join(', ');
  const tooltipLeft = hover !== null ? Math.min(Math.max(px(hover) + 10, 0), width - 170) : 0;

  return (
    <figure className={cx('acr-chart', className)}>
      {multi && (
        <figcaption className="acr-chart__legend">
          {series.map((s, i) => (
            <span key={s.id} className="acr-chart__key">
              <svg width="22" height="10" aria-hidden="true">
                <line x1="1" y1="5" x2="21" y2="5" className={`acr-chart__line acr-chart__line--${s.slot ?? i + 1}`} strokeDasharray={DASH[s.dash ?? 'solid']} />
              </svg>
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
      <div ref={wrapRef} className="acr-chart__plot">
        <svg
          width={width}
          height={height}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="acr-chart__svg"
        >
          <title id={titleId}>{`${label}. Latest: ${summary}.`}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={py(t)} y2={py(t)} className="acr-chart__grid" />
              <text x={PAD.left - 8} y={py(t)} dy="0.32em" textAnchor="end" className="acr-chart__tick">
                {formatValue(t)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={px(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="acr-chart__tick">
              {x[i] !== undefined ? formatTimeOfDay(x[i]!, false) : ''}
            </text>
          ))}
          {series.map((s, si) => {
            const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
            const lastV = s.values[last];
            return (
              <g key={s.id}>
                <path d={d} className={`acr-chart__line acr-chart__line--${s.slot ?? si + 1}`} strokeDasharray={DASH[s.dash ?? 'solid']} />
                {multi && lastV !== undefined && (
                  <text x={px(last) + 6} y={py(lastV)} dy="0.32em" className="acr-chart__direct">
                    {s.label}
                  </text>
                )}
              </g>
            );
          })}
          {hover !== null && (
            <g aria-hidden="true">
              <line x1={px(hover)} x2={px(hover)} y1={PAD.top} y2={PAD.top + plotH} className="acr-chart__cross" />
              {series.map((s, si) =>
                s.values[hover] !== undefined ? <circle key={s.id} cx={px(hover)} cy={py(s.values[hover]!)} r={4} className={`acr-chart__dot acr-chart__dot--${s.slot ?? si + 1}`} /> : null,
              )}
            </g>
          )}
        </svg>
        {hover !== null && x[hover] !== undefined && (
          <div className="acr-chart__tip" style={{ left: tooltipLeft }} role="status">
            <span className="acr-chart__tip-time">{formatTimeOfDay(x[hover]!)}</span>
            {series.map((s) => (
              <span key={s.id} className="acr-chart__tip-row">
                <span>{s.label}</span>
                <strong className="jpb-num">
                  {s.values[hover] !== undefined ? formatValue(s.values[hover]!) : '—'}
                  {unit ? ` ${unit}` : ''}
                </strong>
              </span>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="acr-chart__toggle" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
        {showTable ? 'Hide data table' : 'View as table'}
      </button>
      {showTable && (
        <div className="acr-chart__table">
          <table>
            <caption className="jpb-sr-only">{label}</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                {series.map((s) => (
                  <th key={s.id} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {x
                .map((t, i) => ({ t, i }))
                .slice(-12)
                .reverse()
                .map(({ t, i }) => (
                  <tr key={t}>
                    <th scope="row">{formatTimeOfDay(t, false)}</th>
                    {series.map((s) => (
                      <td key={s.id} className="jpb-num">
                        {s.values[i] !== undefined ? formatValue(s.values[i]!) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
