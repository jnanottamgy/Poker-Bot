import { useId } from 'react';
import { cx } from '../cx';
import { formatChips, formatCount } from '../format';
import { Button } from './Button';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

/* -------------------------------------------------------------- blinds --- */

export interface BlindRow {
  /** Stable key for React (not the level number: rows can be inserted). */
  key: string;
  /** A break row has no blinds. */
  isBreak?: boolean;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  /** Minutes. */
  durationMin: number;
}

export type BlindField = 'smallBlind' | 'bigBlind' | 'ante' | 'durationMin';
export type RowErrors<F extends string> = Partial<Record<F, string>>;

export const BLIND_LIMITS = { maxDurationMin: 240, minDurationMin: 1 } as const;

const isWhole = (n: number): boolean => Number.isSafeInteger(n);

/**
 * Per-row validation of a blind structure (pure, tested):
 * - every amount is a whole number of chips; blinds > 0, ante >= 0
 * - small blind < big blind; ante <= big blind
 * - big blind never decreases from one level to the next (breaks are skipped)
 * - duration 1..240 minutes
 * - a break cannot be first, and two breaks cannot be adjacent
 */
export function validateBlindStructure(rows: BlindRow[]): Array<RowErrors<BlindField>> {
  let prevBB = 0;
  return rows.map((r, i) => {
    const e: RowErrors<BlindField> = {};
    if (!isWhole(r.durationMin) || r.durationMin < BLIND_LIMITS.minDurationMin || r.durationMin > BLIND_LIMITS.maxDurationMin) {
      e.durationMin = `${BLIND_LIMITS.minDurationMin}–${BLIND_LIMITS.maxDurationMin} minutes`;
    }
    if (r.isBreak) {
      if (i === 0) e.durationMin = 'A break cannot be the first level';
      else if (rows[i - 1]?.isBreak) e.durationMin = 'Two breaks in a row';
      return e;
    }
    if (!isWhole(r.smallBlind) || r.smallBlind <= 0) e.smallBlind = 'Whole chips above 0';
    if (!isWhole(r.bigBlind) || r.bigBlind <= 0) e.bigBlind = 'Whole chips above 0';
    else if (!e.smallBlind && r.smallBlind >= r.bigBlind) e.smallBlind = 'Must be below the big blind';
    if (!isWhole(r.ante) || r.ante < 0) e.ante = 'Whole chips, 0 or more';
    else if (!e.bigBlind && r.ante > r.bigBlind) e.ante = 'Cannot exceed the big blind';
    if (!e.bigBlind && r.bigBlind < prevBB) e.bigBlind = `Lower than the previous level (${formatChips(prevBB)})`;
    if (isWhole(r.bigBlind) && r.bigBlind > 0) prevBB = Math.max(prevBB, r.bigBlind);
    return e;
  });
}

export interface BlindStructureEditorProps {
  rows: BlindRow[];
  onChange: (rows: BlindRow[]) => void;
  /** The level currently being played (1-based among non-break rows); earlier rows are read-only. */
  currentLevel?: number;
  readOnly?: boolean;
  /** Called to create a key for a new row. */
  newKey: () => string;
  className?: string;
}

function levelNumbers(rows: BlindRow[]): Array<number | null> {
  let n = 0;
  return rows.map((r) => (r.isBreak ? null : ++n));
}

function NumCell({ id, label, value, error, disabled, onChange }: { id: string; label: string; value: number; error?: string; disabled?: boolean; onChange: (v: number) => void }) {
  return (
    <td className={cx('jpb-se__cell', error && 'is-invalid')}>
      <input
        id={id}
        className="jpb-input jpb-se__input jpb-num"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        value={Number.isFinite(value) ? String(value) : ''}
        disabled={disabled}
        onChange={(e) => {
          const t = e.target.value.replace(/[,\s_]/g, '');
          onChange(/^\d+$/.test(t) ? Number(t) : t === '' ? Number.NaN : Number.NaN);
        }}
      />
      {error && (
        <span id={`${id}-err`} className="jpb-se__err">
          <Icon name="warning" /> {error}
        </span>
      )}
    </td>
  );
}

/**
 * Editable blind structure: one row per level (or break), validated per row
 * with the reason next to the field (aria-invalid + describedby). Levels
 * already played are locked. Insert a level or a break after any row.
 */
export function BlindStructureEditor({ rows, onChange, currentLevel = 0, readOnly = false, newKey, className }: BlindStructureEditorProps) {
  const uid = useId();
  const errors = validateBlindStructure(rows);
  const levels = levelNumbers(rows);
  const errorCount = errors.reduce((n, e) => n + Object.keys(e).length, 0);
  const update = (i: number, patch: Partial<BlindRow>): void => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const insertAfter = (i: number, isBreak: boolean): void => {
    const prev = rows[i];
    const base = rows.slice(0, i + 1).reverse().find((r) => !r.isBreak);
    const row: BlindRow = isBreak
      ? { key: newKey(), isBreak: true, smallBlind: 0, bigBlind: 0, ante: 0, durationMin: 10 }
      : { key: newKey(), smallBlind: (base?.smallBlind ?? 50) * 2, bigBlind: (base?.bigBlind ?? 100) * 2, ante: (base?.ante ?? 0) * 2, durationMin: prev?.durationMin ?? 20 };
    onChange([...rows.slice(0, i + 1), row, ...rows.slice(i + 1)]);
  };
  const remove = (i: number): void => onChange(rows.filter((_, j) => j !== i));

  return (
    <div className={cx('jpb-se', className)}>
      <p className={cx('jpb-se__summary', errorCount > 0 && 'is-invalid')} role="status">
        {errorCount > 0 ? (
          <>
            <Icon name="warning" /> {formatCount(errorCount)} problem{errorCount > 1 ? 's' : ''} to fix before saving
          </>
        ) : (
          <>
            <Icon name="check-circle" /> {formatCount(levels.filter((l) => l !== null).length)} levels · structure is valid
          </>
        )}
      </p>
      <div className="jpb-se__scroll" role="region" aria-label="Blind structure (scrollable)" tabIndex={0}>
        <table className="jpb-se__table">
          <caption className="jpb-sr-only">Blind structure</caption>
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col" className="is-num">
                Small blind
              </th>
              <th scope="col" className="is-num">
                Big blind
              </th>
              <th scope="col" className="is-num">
                Ante
              </th>
              <th scope="col" className="is-num">
                Minutes
              </th>
              <th scope="col">
                <span className="jpb-sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const lvl = levels[i];
              const played = lvl !== null && lvl !== undefined && lvl < currentLevel;
              const locked = readOnly || played;
              const name = r.isBreak ? `Break after level ${levels.slice(0, i).filter((x) => x !== null).length}` : `Level ${lvl}`;
              const e = errors[i] ?? {};
              return (
                <tr key={r.key} className={cx(r.isBreak && 'is-break', lvl === currentLevel && 'is-current', played && 'is-played')}>
                  <th scope="row" className="jpb-se__lvl">
                    {r.isBreak ? (
                      <span className="jpb-se__break">
                        <Icon name="coffee" /> Break
                      </span>
                    ) : (
                      <span className="jpb-num">{lvl}</span>
                    )}
                    {lvl === currentLevel && <span className="jpb-se__now">NOW</span>}
                    {played && <span className="jpb-sr-only"> (played, locked)</span>}
                  </th>
                  {r.isBreak ? (
                    <td colSpan={3} className="jpb-se__breaknote">
                      Clock stops · tables hold
                    </td>
                  ) : (
                    <>
                      <NumCell id={`${uid}-${r.key}-sb`} label={`${name} small blind`} value={r.smallBlind} error={e.smallBlind} disabled={locked} onChange={(v) => update(i, { smallBlind: v })} />
                      <NumCell id={`${uid}-${r.key}-bb`} label={`${name} big blind`} value={r.bigBlind} error={e.bigBlind} disabled={locked} onChange={(v) => update(i, { bigBlind: v })} />
                      <NumCell id={`${uid}-${r.key}-ante`} label={`${name} ante`} value={r.ante} error={e.ante} disabled={locked} onChange={(v) => update(i, { ante: v })} />
                    </>
                  )}
                  <NumCell id={`${uid}-${r.key}-dur`} label={`${name} duration in minutes`} value={r.durationMin} error={e.durationMin} disabled={locked} onChange={(v) => update(i, { durationMin: v })} />
                  <td className="jpb-se__rowact">
                    {!readOnly && (
                      <span className="jpb-se__btns">
                        <IconButton icon="plus" size="sm" label={`Add a level after ${name}`} onClick={() => insertAfter(i, false)} />
                        <IconButton icon="coffee" size="sm" label={`Add a break after ${name}`} onClick={() => insertAfter(i, true)} />
                        <IconButton icon="x" size="sm" variant="danger" label={`Remove ${name}`} disabled={locked || rows.length <= 1} onClick={() => remove(i)} />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- payouts --- */

export interface PayoutRow {
  key: string;
  /** First and last place of the band (inclusive, 1-based). */
  fromPlace: number;
  toPlace: number;
  /** Per-player share in basis points (1% = 100 bp). Integers only: money never floats. */
  bpEach: number;
}

export type PayoutField = 'fromPlace' | 'toPlace' | 'bpEach';

/**
 * Payout validation (pure, tested): bands are contiguous from 1st place, each
 * band's per-player share is a whole number of basis points > 0 and never
 * larger than the band above it, and the total is exactly 100.00%
 * (`totalBp` = sum of bpEach * band size = 10,000).
 */
export function validatePayouts(rows: PayoutRow[], paidPlaces?: number): { rows: Array<RowErrors<PayoutField>>; totalBp: number; total?: string } {
  let expect = 1;
  let prevBp = Number.POSITIVE_INFINITY;
  let totalBp = 0;
  const out = rows.map((r) => {
    const e: RowErrors<PayoutField> = {};
    if (!isWhole(r.fromPlace) || r.fromPlace !== expect) e.fromPlace = `Should start at ${formatCount(expect)}`;
    if (!isWhole(r.toPlace) || r.toPlace < r.fromPlace) e.toPlace = 'Must be at or after the first place';
    if (!isWhole(r.bpEach) || r.bpEach <= 0) e.bpEach = 'Above 0%';
    else if (r.bpEach > prevBp) e.bpEach = 'More than the place above';
    if (isWhole(r.toPlace) && r.toPlace >= r.fromPlace) {
      expect = r.toPlace + 1;
      if (isWhole(r.bpEach) && r.bpEach > 0) {
        totalBp += r.bpEach * (r.toPlace - r.fromPlace + 1);
        prevBp = r.bpEach;
      }
    }
    return e;
  });
  let total: string | undefined;
  if (totalBp !== 10_000) total = `Total is ${(totalBp / 100).toFixed(2)}% — must be exactly 100.00%`;
  else if (paidPlaces !== undefined && expect - 1 !== paidPlaces) total = `Pays ${formatCount(expect - 1)} places, structure says ${formatCount(paidPlaces)}`;
  return { rows: out, totalBp, total };
}

export interface PayoutEditorProps {
  rows: PayoutRow[];
  onChange: (rows: PayoutRow[]) => void;
  /** Prize pool in minor units, to preview each band's amount. */
  prizePoolMinor?: number;
  formatMoney?: (minor: number) => string;
  paidPlaces?: number;
  readOnly?: boolean;
  newKey: () => string;
  className?: string;
}

/** Editable payout table (per-place % in hundredths), with live totals and per-row validation. */
export function PayoutEditor({ rows, onChange, prizePoolMinor, formatMoney, paidPlaces, readOnly = false, newKey, className }: PayoutEditorProps) {
  const uid = useId();
  const v = validatePayouts(rows, paidPlaces);
  const update = (i: number, patch: Partial<PayoutRow>): void => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const last = rows[rows.length - 1];
  return (
    <div className={cx('jpb-se', className)}>
      <p className={cx('jpb-se__summary', v.total && 'is-invalid')} role="status">
        <Icon name={v.total ? 'warning' : 'check-circle'} /> {v.total ?? `100.00% across ${formatCount(last?.toPlace ?? 0)} places`}
      </p>
      <div className="jpb-se__scroll" role="region" aria-label="Payouts (scrollable)" tabIndex={0}>
        <table className="jpb-se__table">
          <caption className="jpb-sr-only">Payout structure</caption>
          <thead>
            <tr>
              <th scope="col" className="is-num">
                From
              </th>
              <th scope="col" className="is-num">
                To
              </th>
              <th scope="col" className="is-num">
                Each (%)
              </th>
              {prizePoolMinor !== undefined && formatMoney && (
                <th scope="col" className="is-num">
                  Each
                </th>
              )}
              <th scope="col">
                <span className="jpb-sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const e = v.rows[i] ?? {};
              const name = r.fromPlace === r.toPlace ? `Place ${r.fromPlace}` : `Places ${r.fromPlace} to ${r.toPlace}`;
              return (
                <tr key={r.key}>
                  <NumCell id={`${uid}-${r.key}-from`} label={`${name}: first place`} value={r.fromPlace} error={e.fromPlace} disabled={readOnly} onChange={(x) => update(i, { fromPlace: x })} />
                  <NumCell id={`${uid}-${r.key}-to`} label={`${name}: last place`} value={r.toPlace} error={e.toPlace} disabled={readOnly} onChange={(x) => update(i, { toPlace: x })} />
                  <td className={cx('jpb-se__cell', e.bpEach && 'is-invalid')}>
                    <input
                      key={`${r.key}-${r.bpEach}`}
                      id={`${uid}-${r.key}-pct`}
                      className="jpb-input jpb-se__input jpb-num"
                      inputMode="decimal"
                      aria-label={`${name}: percent of the prize pool each`}
                      aria-invalid={e.bpEach ? true : undefined}
                      aria-describedby={e.bpEach ? `${uid}-${r.key}-pct-err` : undefined}
                      defaultValue={(r.bpEach / 100).toFixed(2)}
                      disabled={readOnly}
                      onBlur={(ev) => {
                        const t = ev.target.value.trim();
                        const ok = /^\d+(\.\d{1,2})?$/.test(t);
                        update(i, { bpEach: ok ? Math.round(Number(t) * 100) : Number.NaN });
                      }}
                    />
                    {e.bpEach && (
                      <span id={`${uid}-${r.key}-pct-err`} className="jpb-se__err">
                        <Icon name="warning" /> {e.bpEach}
                      </span>
                    )}
                  </td>
                  {prizePoolMinor !== undefined && formatMoney && <td className="is-num jpb-num jpb-se__money">{Number.isFinite(r.bpEach) ? formatMoney(Math.floor((prizePoolMinor * r.bpEach) / 10_000)) : '—'}</td>}
                  <td className="jpb-se__rowact">
                    {!readOnly && <IconButton icon="x" size="sm" variant="danger" label={`Remove ${name}`} disabled={rows.length <= 1} onClick={() => onChange(rows.filter((_, j) => j !== i))} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <Button
          size="sm"
          icon="plus"
          onClick={() => {
            const from = (last?.toPlace ?? 0) + 1;
            onChange([...rows, { key: newKey(), fromPlace: from, toPlace: from, bpEach: Math.max(1, Math.floor((last?.bpEach ?? 100) / 2)) }]);
          }}
        >
          Add band
        </Button>
      )}
    </div>
  );
}
