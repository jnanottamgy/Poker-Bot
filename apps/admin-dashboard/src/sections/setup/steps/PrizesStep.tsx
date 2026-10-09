import { useState } from 'react';
import type { PrizePlace } from '@jpb/shared-types';
import { Button, Icon, IconButton, Select, TextArea, TextField, cx, formatCount, formatMoneyMinor, formatOrdinal } from '@jpb/ui';
import { CONFIG_LIMITS } from '@jpb/validation';
import { useWizard } from '../components/context';
import { CellInput, useFieldIssue, useTextBinding } from '../components/fields';
import { Fact, Group, Note } from '../components/Group';
import { IssueList } from '../components/IssueList';
import { VirtualRows } from '../components/VirtualRows';
import { isNum, moneyText, parseMoneyText } from '../model/format';
import { fieldDomId } from '../model/issues';
import { PERCENT_PRESETS, appendPlace, distributePool, formatBp, insertPlaceAfter, parsePercentages, percentText, removePlace, setPlace, shareBp, totalMinor } from '../model/prizes';

const ROW_HEIGHT = 58;
const COLUMNS = '72px minmax(140px, 1fr) 84px minmax(160px, 1.3fr) 82px';
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];
/** Rounding choices of the distribution helper, in major units. */
const ROUNDINGS = [
  { value: '1', label: 'Exact (smallest unit)' },
  { value: '100', label: 'Whole units (1)' },
  { value: '1000', label: 'Tens (10)' },
  { value: '10000', label: 'Hundreds (100)' },
  { value: '100000', label: 'Thousands (1,000)' },
];
const DEFAULT_ROUNDING = '100';

function LabelCell({ index, place }: { index: number; place: PrizePlace }) {
  const { update, readOnly } = useWizard();
  const { id, error } = useFieldIssue(`prizeStructure.places[${index}].label`);
  return (
    <span className={cx('acr-setup-cell', error && 'is-invalid')}>
      <input
        id={id}
        className="jpb-input acr-setup-cell__input acr-setup-cell__input--text"
        aria-label={`Place ${index + 1} label`}
        aria-invalid={error ? true : undefined}
        placeholder="e.g. Trophy + voucher"
        value={place.label ?? ''}
        disabled={readOnly}
        onChange={(e) => update((c) => ({ ...c, prizeStructure: { ...c.prizeStructure, places: setPlace(c.prizeStructure.places, index, { label: e.target.value }) } }))}
      />
      {error && (
        <span className="acr-setup-cell__err" title={error}>
          <Icon name="warning" /> {error}
        </span>
      )}
    </span>
  );
}

function PlacesEditor({ total }: { total: number | null }) {
  const { config, update } = useWizard();
  const { currency, places } = config.prizeStructure;
  const set = (fn: (p: PrizePlace[]) => PrizePlace[]) => update((c) => ({ ...c, prizeStructure: { ...c.prizeStructure, places: fn(c.prizeStructure.places) } }));
  const header = (
    <>
      <span role="columnheader" className="acr-setup-vtable__th">
        Place
      </span>
      <span role="columnheader" className="acr-setup-vtable__th is-num">
        Amount ({currency})
      </span>
      <span role="columnheader" className="acr-setup-vtable__th is-num">
        Share
      </span>
      <span role="columnheader" className="acr-setup-vtable__th">
        Label (optional)
      </span>
      <span role="columnheader" className="acr-setup-vtable__th">
        <span className="jpb-sr-only">Actions</span>
      </span>
    </>
  );
  const renderRow = (i: number) => {
    const p = places[i]!;
    const share = shareBp(p.amountMinor, total);
    return (
      <div className="acr-setup-vtable__cells">
        <span role="cell" className="acr-setup-vtable__td acr-setup-levelno jpb-num" id={fieldDomId(`prizeStructure.places[${i}]`)} tabIndex={-1}>
          {formatOrdinal(i + 1)}
        </span>
        <span role="cell" className="acr-setup-vtable__td is-num">
          <CellInput path={`prizeStructure.places[${i}].amountMinor`} label={`Place ${i + 1} amount`} kind="money" currency={currency} value={p.amountMinor} onChange={(v) => set((ps) => setPlace(ps, i, { amountMinor: v }))} />
        </span>
        <span role="cell" className="acr-setup-vtable__td is-num acr-setup-dim jpb-num">
          {share === null ? '—' : formatBp(share)}
        </span>
        <span role="cell" className="acr-setup-vtable__td">
          <LabelCell index={i} place={p} />
        </span>
        <span role="cell" className="acr-setup-vtable__td acr-setup-rowactions">
          <IconButton icon="plus" size="sm" label={`Insert a place after place ${i + 1}`} disabled={places.length >= CONFIG_LIMITS.MAX_PRIZE_PLACES} onClick={() => set((ps) => insertPlaceAfter(ps, i))} />
          <IconButton icon="x" size="sm" variant="ghost" label={`Remove place ${i + 1}`} onClick={() => set((ps) => removePlace(ps, i))} />
        </span>
      </div>
    );
  };
  return (
    <VirtualRows
      label="Paid places"
      arrayPath="prizeStructure.places"
      count={places.length}
      rowHeight={ROW_HEIGHT}
      columns={COLUMNS}
      minWidth={620}
      maxHeight={480}
      header={header}
      renderRow={renderRow}
      empty={<p className="acr-setup-dim">No paid places: the tournament awards no money (you can still describe trophies in the notes).</p>}
    />
  );
}

function Distributor() {
  const { config, update, readOnly } = useWizard();
  const currency = config.prizeStructure.currency;
  const [pool, setPool] = useState<number>(() => totalMinor(config.prizeStructure.places) ?? Number.NaN);
  const [percentages, setPercentages] = useState(() => percentText(PERCENT_PRESETS[2]!.bp));
  const [rounding, setRounding] = useState(DEFAULT_ROUNDING);
  const poolBind = useTextBinding(pool, (v) => moneyText(v, currency), (t) => parseMoneyText(t, currency), (v) => setPool(v ?? Number.NaN), (v) => moneyText(v, currency, true));
  const parsed = parsePercentages(percentages);
  const poolOk = isNum(pool) && Number.isSafeInteger(pool) && pool > 0;
  const problems = [...(poolOk ? [] : ['Enter the prize pool (more than 0).']), ...parsed.problems];
  const preview = problems.length === 0 ? distributePool(pool, parsed.bp, Number(rounding)) : [];

  const apply = () => {
    if (preview.length === 0) return;
    update((c) => ({ ...c, prizeStructure: { ...c.prizeStructure, places: preview.map((p, i) => ({ ...p, ...(c.prizeStructure.places[i]?.label ? { label: c.prizeStructure.places[i]!.label } : {}) })) } }), {
      undoLabel: `Split ${formatMoneyMinor(pool, currency)} over ${preview.length} place${preview.length === 1 ? '' : 's'}`,
    });
  };

  return (
    <details className="acr-setup-details" open={config.prizeStructure.places.length === 0 ? true : undefined}>
      <summary>
        <Icon name="sliders" /> Distribute a pool by percentages
      </summary>
      <div className="acr-setup-details__body">
        <div className="acr-setup-presetchips" role="group" aria-label="Percentage presets">
          {PERCENT_PRESETS.map((p) => (
            <button key={p.id} type="button" className={cx('acr-setup-chip', percentText(p.bp) === percentText(parsed.bp) && 'is-active')} onClick={() => setPercentages(percentText(p.bp))} disabled={readOnly}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="acr-setup-grid acr-setup-grid--3">
          <TextField id="setup-f-__pool" label="Prize pool" suffix={currency} inputMode="decimal" autoComplete="off" disabled={readOnly} {...poolBind} />
          <TextField id="setup-f-__percent" label="Percentages, 1st place first" hint="e.g. 50 / 30 / 20 — must total 100 and never increase" value={percentages} disabled={readOnly} onChange={(e) => setPercentages(e.target.value)} autoComplete="off" />
          <Select label="Round each prize to" value={rounding} options={ROUNDINGS} disabled={readOnly} onChange={(e) => setRounding(e.target.value)} hint="Rounding remainder goes to 1st place" />
        </div>
        {problems.length > 0 ? (
          <ul className="acr-setup-groupissues">
            {problems.map((p) => (
              <li key={p}>
                <Icon name="warning" /> {p}
              </li>
            ))}
          </ul>
        ) : (
          <p className="acr-setup-distpreview" aria-live="polite">
            <span className="acr-setup-dim">Preview:</span>{' '}
            {preview.slice(0, 6).map((p, i) => (
              <span key={p.position} className="jpb-num">
                {i > 0 && ' · '}
                {formatOrdinal(p.position)} {formatMoneyMinor(p.amountMinor, currency)}
              </span>
            ))}
            {preview.length > 6 && <span className="acr-setup-dim"> · and {formatCount(preview.length - 6)} more</span>}
          </p>
        )}
        <div className="acr-setup-inline">
          <Button size="sm" variant="primary" icon="zap" disabled={preview.length === 0 || readOnly} onClick={apply}>
            Replace the paid places
          </Button>
          <span className="acr-setup-dim">amountᵢ = ⌊pool × pctᵢ ÷ round⌋ × round; the total is exactly the pool. Undo available.</span>
        </div>
      </div>
    </details>
  );
}

/** Step 7 — currency, the paid places table (with a pool-by-percentages helper) and prize notes. */
export function PrizesStep() {
  const { config, update, validation, readOnly } = useWizard();
  const ps = config.prizeStructure;
  const cur = useFieldIssue('prizeStructure.currency');
  const notes = useFieldIssue('prizeStructure.notes');
  const total = totalMinor(ps.places);
  const placesIssues = validation.issues.filter((i) => i.path === 'prizeStructure.places' || i.path === 'prizeStructure');
  const paidShare = isNum(config.maxPlayers) && config.maxPlayers > 0 ? ps.places.length / config.maxPlayers : null;
  const setPs = (patch: Partial<typeof ps>) => update((c) => ({ ...c, prizeStructure: { ...c.prizeStructure, ...patch } }));

  return (
    <>
      <Group title="Currency" icon="trophy" description="Prizes are money in integer minor units (paise, cents) — never chips.">
        <div className="acr-setup-inline acr-setup-inline--end">
          <TextField
            id={cur.id}
            label="Currency"
            required
            value={ps.currency}
            error={cur.error}
            hint="ISO 4217 code"
            className="acr-setup-currency"
            maxLength={3}
            autoComplete="off"
            spellCheck={false}
            disabled={readOnly}
            onChange={(e) => setPs({ currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
          />
          <div className="acr-setup-presetchips" role="group" aria-label="Common currencies">
            {CURRENCIES.map((c) => (
              <button key={c} type="button" className={cx('acr-setup-chip', ps.currency === c && 'is-active')} aria-pressed={ps.currency === c} disabled={readOnly} onClick={() => setPs({ currency: c })}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </Group>

      <Group
        title="Paid places"
        icon="award"
        id={fieldDomId('prizeStructure.places')}
        description="Positions are 1, 2, 3 … in order; a place never pays more than the one above it."
        actions={
          <>
            <Button size="sm" icon="plus" disabled={ps.places.length >= CONFIG_LIMITS.MAX_PRIZE_PLACES} onClick={() => setPs({ places: appendPlace(ps.places) })}>
              Add place
            </Button>
            <Button size="sm" variant="ghost" icon="x" disabled={ps.places.length === 0} onClick={() => update((c) => ({ ...c, prizeStructure: { ...c.prizeStructure, places: [] } }), { undoLabel: 'Removed every paid place' })}>
              Clear
            </Button>
          </>
        }
      >
        <div className="acr-setup-facts">
          <Fact label="Total prize pool" value={total === null ? '—' : formatMoneyMinor(total, ps.currency || 'INR')} />
          <Fact label="Paid places" value={formatCount(ps.places.length)} sub={paidShare !== null ? `${(paidShare * 100).toLocaleString('en-US', paidShare < 0.01 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 1 })} % of a full field` : undefined} />
          <Fact label="1st place" value={ps.places[0] && isNum(ps.places[0].amountMinor) ? formatMoneyMinor(ps.places[0].amountMinor, ps.currency || 'INR') : '—'} />
          <Fact label="Hand-for-hand bubble" value={config.handForHand.autoAtBubble ? `${formatCount(ps.places.length + 1)} players left` : 'Off'} />
        </div>
        <IssueList issues={placesIssues} label="Prize table problems" />
        <Distributor />
        <PlacesEditor total={total} />
        {ps.places.length > 0 && <Note>Payouts are recorded in the Payouts screen after the tournament; the platform never moves money.</Note>}
      </Group>

      <Group title="Prize notes" icon="message" description="Optional: trophies, goodies, how and when prizes are handed out. Shown on the join page and the summary.">
        <TextArea
          id={notes.id}
          label="Notes"
          value={ps.notes ?? ''}
          error={notes.error}
          rows={3}
          hint={`${(ps.notes ?? '').length} / ${formatCount(CONFIG_LIMITS.PRIZE_NOTES_MAX_LENGTH)} characters`}
          disabled={readOnly}
          onChange={(e) =>
            update((c) => {
              const { notes: _n, ...rest } = c.prizeStructure;
              return { ...c, prizeStructure: e.target.value === '' ? rest : { ...rest, notes: e.target.value } };
            })
          }
        />
      </Group>
    </>
  );
}
