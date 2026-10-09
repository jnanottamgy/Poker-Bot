import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { HandListItemDto, Paginated } from '@jpb/shared-types';
import { Button, IconButton, Panel, ProgressBar, cx, formatCount, formatPercent } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { formatDuration } from '../../lib/time';
import { BUNDLE_PAGE, MAX_ISSUES } from './bulk';
import type { BulkMode, BulkState } from './bulk';
import { BUNDLE_CHECK_LABEL, FAIRNESS_METHOD, downloadJson, fileSlug, isSampleSeed, newSampleSeed } from './engine';
import { VerdictPill } from './ui';
import { useBulkVerify } from './useFairness';

export const DEFAULT_SAMPLE = 200;
export const MAX_SAMPLE = 20_000;
/** Issues listed on screen (all of them are in the downloaded report). */
const SHOWN_ISSUES = 100;

function rateText(s: BulkState, now: number): { rate: string; eta: string } {
  const elapsed = Math.max(1, (s.finishedAt || now) - s.startedAt);
  const perSec = (s.done * 1000) / elapsed;
  const left = s.target - s.done;
  return {
    rate: `${formatCount(Math.round(perSec))} hands/s`,
    eta: perSec > 0 && left > 0 ? `about ${formatDuration((left / perSec) * 1000)} left` : '',
  };
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function report(tournamentId: string, s: BulkState) {
  return {
    format: 'JPB-ADMIN-VERIFICATION-REPORT',
    note: 'Produced in the admin control room by the portable @jpb/fairness-engine running in the browser. The server was not asked for a verdict.',
    tournamentId,
    mode: s.mode,
    sampleId: s.sampleSeed,
    seed: s.seedProvided ? 'entered by the operator' : s.seedAvailable ? 'revealed seed from the export' : 'not revealed',
    status: s.status,
    counts: { target: s.target, verified: s.verified, failed: s.failed, incomplete: s.incomplete, checked: s.done },
    tournamentChecks: s.tournamentChecks,
    issues: s.issues,
    issuesTotal: s.issuesTotal,
    method: FAIRNESS_METHOD,
    startedAt: new Date(s.startedAt).toISOString(),
    finishedAt: s.finishedAt ? new Date(s.finishedAt).toISOString() : null,
  };
}

export interface BulkPanelProps {
  tournamentId: string;
  /** undefined = revealed seed; string = typed seed; null = typed seed missing / invalid. */
  seedOverride: string | null | undefined;
  seedRevealed: boolean;
  onVerifyHand: (handId: string) => void;
}

/** §2.11 bulk verification: a reproducible sample or every hand, in the browser, with progress. */
export function BulkPanel({ tournamentId, seedOverride, seedRevealed, onVerifyHand }: BulkPanelProps) {
  const api = useApi();
  const bulk = useBulkVerify(tournamentId);
  const s = bulk.state;
  const [mode, setMode] = useState<BulkMode>('sample');
  const [size, setSize] = useState(String(DEFAULT_SAMPLE));
  const [sampleSeed, setSampleSeed] = useState(newSampleSeed);
  const totalQ = { offset: 0, limit: 1 };
  const total = useQuery<Paginated<HandListItemDto>>(qk.hands(tournamentId, totalQ), (sig) => api.hands.list(tournamentId, totalQ, sig), { staleMs: 15_000 }).data?.total ?? null;
  const now = useNow(bulk.running);
  const n = Number(size);
  const sizeOk = Number.isInteger(n) && n >= 1 && n <= MAX_SAMPLE;
  const seedOk = isSampleSeed(sampleSeed);
  const canStart = !bulk.running && seedOverride !== null && (mode === 'all' || (sizeOk && seedOk)) && total !== null && total > 0;
  const { rate, eta } = rateText(s, now);
  const finished = s.phase === 'done' || s.phase === 'cancelled' || s.phase === 'error';

  const start = () =>
    bulk.start({
      mode,
      sampleSize: Math.min(n, total ?? n),
      sampleSeed: sampleSeed.toLowerCase(),
      ...(typeof seedOverride === 'string' ? { seedOverride } : {}),
    });

  return (
    <Panel title="Bulk verification" icon="activity" description="Verifies many hands in this browser — a reproducible random sample or every hand — and lists anything that is not VERIFIED." className="acr-fair-bulk">
      {seedOverride === null && (
        <p className="acr-fair-note" role="note">
          Enter a valid seed in “Seed used for verification”, or switch back to the revealed seed, to start.
        </p>
      )}
      {!seedRevealed && seedOverride === undefined && (
        <p className="acr-fair-note" role="note">
          The seed is still secret, so card checks will report NOT AVAILABLE. Format, public entropy and hand consistency are still checked.
        </p>
      )}
      <div className="acr-fair-bulk__form" role="group" aria-label="Bulk verification options">
        <div className="acr-fair-seg" role="group" aria-label="Which hands">
          <button type="button" aria-pressed={mode === 'sample'} className={cx('acr-fair-seg__btn', mode === 'sample' && 'is-on')} onClick={() => setMode('sample')} disabled={bulk.running}>
            Random sample
          </button>
          <button type="button" aria-pressed={mode === 'all'} className={cx('acr-fair-seg__btn', mode === 'all' && 'is-on')} onClick={() => setMode('all')} disabled={bulk.running}>
            All hands
          </button>
        </div>
        {mode === 'sample' ? (
          <>
            <label className="acr-fair-field acr-fair-field--size">
              <span className="acr-fair-field__label">Hands</span>
              <input className="jpb-input jpb-num" inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} aria-invalid={!sizeOk || undefined} disabled={bulk.running} />
            </label>
            <label className="acr-fair-field acr-fair-field--seed">
              <span className="acr-fair-field__label">Sample id (reproducible)</span>
              <span className="acr-fair-field__row">
                <input className="jpb-input jpb-mono" value={sampleSeed} onChange={(e) => setSampleSeed(e.target.value.trim().slice(0, 64))} aria-invalid={!seedOk || undefined} spellCheck={false} disabled={bulk.running} />
                <IconButton icon="refresh" label="New random sample id" onClick={() => setSampleSeed(newSampleSeed())} disabled={bulk.running} variant="secondary" />
              </span>
            </label>
          </>
        ) : (
          <p className="acr-fair-dim acr-fair-bulk__allnote">
            {total === null ? 'Counting hands…' : `${formatCount(total)} hands in ${formatCount(Math.ceil(total / BUNDLE_PAGE))} export pages of up to ${BUNDLE_PAGE}.`}
          </p>
        )}
        <div className="acr-fair-bulk__go">
          {bulk.running ? (
            <Button variant="danger-outline" icon="x" onClick={bulk.cancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="primary" icon="play" onClick={start} disabled={!canStart}>
              {mode === 'all' ? 'Verify all hands' : `Verify ${sizeOk ? formatCount(Math.min(n, total ?? n)) : ''} hands`}
            </Button>
          )}
        </div>
      </div>
      {mode === 'sample' && !sizeOk && <p className="acr-fair-error">Choose between 1 and {formatCount(MAX_SAMPLE)} hands.</p>}
      {mode === 'sample' && !seedOk && <p className="acr-fair-error">The sample id is hexadecimal (pick a new one with the refresh button).</p>}
      {total === 0 && <p className="acr-fair-dim">No completed hands yet.</p>}

      {s.phase !== 'idle' && (
        <div className="acr-fair-run" aria-live="polite" aria-busy={bulk.running || undefined}>
          <ProgressBar
            value={s.done}
            max={Math.max(1, s.target)}
            label={s.phase === 'preparing' ? 'Preparing: tournament checks and public entropy…' : s.phase === 'running' ? `Verifying ${s.mode === 'all' ? 'every hand' : 'the sample'}…` : s.phase === 'cancelled' ? 'Cancelled' : s.phase === 'error' ? 'Stopped' : 'Finished'}
            valueText={`${formatCount(s.done)} / ${formatCount(s.target)}`}
            tone={s.failed > 0 ? 'danger' : s.phase === 'error' || s.phase === 'cancelled' ? 'warning' : 'positive'}
          />
          <div className="acr-fair-run__stats">
            <span className="acr-fair-stat is-ok">
              <strong className="jpb-num">{formatCount(s.verified)}</strong> verified
            </span>
            <span className={cx('acr-fair-stat', s.failed > 0 && 'is-bad')}>
              <strong className="jpb-num">{formatCount(s.failed)}</strong> failed
            </span>
            <span className={cx('acr-fair-stat', s.incomplete > 0 && 'is-warn')}>
              <strong className="jpb-num">{formatCount(s.incomplete)}</strong> incomplete
            </span>
            <span className="acr-fair-dim">
              {s.done > 0 ? rate : ''}
              {bulk.running && eta ? ` · ${eta}` : ''}
              {finished && s.target > 0 ? ` · ${formatPercent(s.done / s.target)} checked in ${formatDuration((s.finishedAt || now) - s.startedAt)}` : ''}
            </span>
          </div>
          {s.phase === 'error' && <p className="acr-fair-error">{s.error}</p>}
          {s.status && (
            <div className={cx('acr-fair-verdictbar', `is-${s.status.toLowerCase()}`)}>
              <div className="acr-fair-verdictbar__main">
                <VerdictPill status={s.status} />
                <p className="acr-fair-verdictbar__title">
                  {s.status === 'VERIFIED'
                    ? `All ${formatCount(s.done)} ${s.mode === 'sample' ? 'sampled ' : ''}hands verified`
                    : s.status === 'FAILED'
                      ? `${formatCount(s.failed)} hand(s) or tournament check(s) FAILED`
                      : 'Not everything could be verified'}
                </p>
              </div>
              <Button size="sm" variant="secondary" icon="download" onClick={() => downloadJson(`verification-report-${fileSlug(tournamentId)}.json`, report(tournamentId, s))}>
                Download report
              </Button>
            </div>
          )}
          {s.tournamentChecks.length > 0 && (
            <ul className="acr-fair-tchecks" aria-label="Tournament-level checks">
              {s.tournamentChecks.map((c) => (
                <li key={c.check}>
                  <span className="acr-fair-tchecks__name">{BUNDLE_CHECK_LABEL[c.check]}</span>
                  <VerdictPill status={c.status} size="sm" />
                  <span className="acr-fair-tchecks__detail">{c.detail}</span>
                  {c.problems.length > 0 && (
                    <ul className="acr-fair-problems">
                      {c.problems.slice(0, 5).map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                      {c.problems.length > 5 && <li>… {c.problems.length - 5} more in the report</li>}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {s.issues.length > 0 && (
            <div className="acr-fair-issues">
              <p className="acr-fair-issues__title">
                Hands that are not VERIFIED ({formatCount(s.issuesTotal)}
                {s.issuesTotal > MAX_ISSUES ? `; the first ${formatCount(MAX_ISSUES)} are kept` : ''})
              </p>
              <ul>
                {s.issues.slice(0, SHOWN_ISSUES).map((i, k) => (
                  <li key={`${i.handId}-${k}`} className={`is-${i.status.toLowerCase()}`}>
                    <VerdictPill status={i.status} size="sm" />
                    <span className="acr-fair-issues__hand jpb-num">#{i.handNumber ?? '?'}</span>
                    <span className="acr-fair-issues__reason">{i.reason}</span>
                    {i.handId && (
                      <span className="acr-fair-issues__links">
                        <button type="button" className="acr-link acr-fair-linkbtn" onClick={() => onVerifyHand(i.handId!)}>
                          Details
                        </button>
                        <Link className="acr-link" to={sectionHref('hand-detail', tournamentId, { handId: i.handId })}>
                          Replay
                        </Link>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {s.issues.length > SHOWN_ISSUES && <p className="acr-fair-dim">{formatCount(s.issues.length - SHOWN_ISSUES)} more in the downloaded report.</p>}
            </div>
          )}
          {finished && (
            <Button size="sm" variant="ghost" icon="x" onClick={bulk.reset}>
              Clear results
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}
