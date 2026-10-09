import { useEffect, useRef, useState } from 'react';
import type { FairnessExport } from '@jpb/shared-types';
import { Button, Panel, ProgressBar, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { BUNDLE_PAGE } from './bulk';
import { downloadJson, fileSlug, mergeBundles } from './engine';

/** Hands per downloaded file (larger ranges are exported in several files). */
export const EXPORT_MAX = 10_000;

interface ExportRun {
  phase: 'idle' | 'running' | 'done' | 'error';
  done: number;
  target: number;
  message: string;
}

const IDLE: ExportRun = { phase: 'idle', done: 0, target: 0, message: '' };

/** Range of hand positions (1-based, inclusive) → validation message or null. */
export function exportRangeProblem(from: number, to: number, total: number): string | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return 'Enter a range like 1 – 500.';
  if (from > total) return `There are only ${formatCount(total)} hands.`;
  if (to - from + 1 > EXPORT_MAX) return `Export at most ${formatCount(EXPORT_MAX)} hands per file.`;
  return null;
}

/**
 * §2.11 "Export the verification bundle (JSON)": the server's JPB fairness
 * export for a range of hands (fetched in pages of 500 and joined), exactly
 * as published, for verification with any independent tool.
 */
export function ExportPanel({ tournamentId, total, seedRevealed }: { tournamentId: string; total: number | null; seedRevealed: boolean }) {
  const api = useApi();
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('');
  const [run, setRun] = useState<ExportRun>(IDLE);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  // Default range once the count is known: the first page of hands.
  const initialised = useRef(false);
  useEffect(() => {
    if (total === null || initialised.current) return;
    initialised.current = true;
    setTo(String(Math.max(1, Math.min(total, BUNDLE_PAGE))));
  }, [total]);

  const f = Number(from);
  const t = Number(to);
  const problem = total === null ? null : exportRangeProblem(f, t, total);
  const span = problem === null && total !== null ? Math.min(t, total) - f + 1 : 0;

  const start = async () => {
    if (total === null || problem !== null) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const last = Math.min(t, total);
    setRun({ phase: 'running', done: 0, target: last - f + 1, message: '' });
    const pages: FairnessExport[] = [];
    try {
      for (let p = f - 1; p < last; p += BUNDLE_PAGE) {
        const page = await api.fairness.bundle(tournamentId, { fromHand: p, toHand: Math.min(p + BUNDLE_PAGE, last) - 1 }, c.signal);
        if (c.signal.aborted) return;
        pages.push(page);
        setRun((r) => ({ ...r, done: Math.min(r.target, r.done + page.hands.length) }));
      }
      const merged = mergeBundles(pages);
      if (!merged) throw new Error('empty');
      const ok = downloadJson(`fairness-export-${fileSlug(tournamentId)}-hands-${f}-${last}.json`, merged);
      setRun((r) => ({ ...r, phase: 'done', message: ok ? `Saved ${formatCount(merged.hands.length)} hands.` : 'This browser cannot save files from here; try another browser.' }));
    } catch (err) {
      if (c.signal.aborted) return;
      setRun((r) => ({ ...r, phase: 'error', message: `Export failed. ${friendlyError(err).description}` }));
    }
  };

  const quick = (a: number, b: number) => {
    setFrom(String(a));
    setTo(String(b));
  };

  return (
    <Panel title="Export verification bundle" icon="download" description="The published JSON export (JPB-FAIRNESS-EXPORT v1): commitment, seed (once revealed), entropy inputs and every hand record in the range." className="acr-fair-export">
      {!seedRevealed && <p className="acr-fair-note">The seed is not revealed yet: the export can be checked for format and entropy now and fully verified after the reveal.</p>}
      <div className="acr-fair-export__range">
        <label className="acr-fair-field">
          <span className="acr-fair-field__label">From hand</span>
          <input className="jpb-input jpb-num" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))} aria-invalid={problem !== null || undefined} />
        </label>
        <span className="acr-fair-export__dash" aria-hidden="true">
          –
        </span>
        <label className="acr-fair-field">
          <span className="acr-fair-field__label">To hand</span>
          <input className="jpb-input jpb-num" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))} aria-invalid={problem !== null || undefined} />
        </label>
        <Button variant="primary" icon="download" onClick={() => void start()} disabled={total === null || total === 0 || problem !== null || run.phase === 'running'} loading={run.phase === 'running'} loadingLabel="Exporting…">
          Export JSON
        </Button>
      </div>
      {total !== null && total > 0 && (
        <div className="acr-fair-export__quick" role="group" aria-label="Quick ranges">
          <button type="button" className="acr-fair-chip" onClick={() => quick(1, Math.min(total, BUNDLE_PAGE))}>
            First {formatCount(Math.min(total, BUNDLE_PAGE))}
          </button>
          <button type="button" className="acr-fair-chip" onClick={() => quick(Math.max(1, total - BUNDLE_PAGE + 1), total)}>
            Latest {formatCount(Math.min(total, BUNDLE_PAGE))}
          </button>
          <button type="button" className="acr-fair-chip" onClick={() => quick(1, Math.min(total, EXPORT_MAX))}>
            {total <= EXPORT_MAX ? `All ${formatCount(total)}` : `First ${formatCount(EXPORT_MAX)}`}
          </button>
        </div>
      )}
      <p className="acr-fair-dim">
        Positions count completed hands from the first one (oldest = 1){total !== null ? ` · ${formatCount(total)} hands so far` : ''}
        {span > 0 ? ` · ${formatCount(Math.ceil(span / BUNDLE_PAGE))} request${span > BUNDLE_PAGE ? 's' : ''}` : ''}.
      </p>
      {problem && <p className="acr-fair-error">{problem}</p>}
      {run.phase !== 'idle' && (
        <div className="acr-fair-export__run" aria-live="polite">
          {run.phase === 'running' && <ProgressBar value={run.done} max={Math.max(1, run.target)} label="Fetching hand records" valueText={`${formatCount(run.done)} / ${formatCount(run.target)}`} />}
          {run.message && <p className={run.phase === 'error' ? 'acr-fair-error' : 'acr-fair-ok'}>{run.message}</p>}
        </div>
      )}
    </Panel>
  );
}
