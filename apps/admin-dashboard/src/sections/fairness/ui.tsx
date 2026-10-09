import { useCallback } from 'react';
import type { ReactNode } from 'react';
import type { FairnessCheckResult, FairnessCheckStatus, FairnessOverallStatus } from '@jpb/shared-types';
import { IconButton, StatusPill, cx, useToast } from '@jpb/ui';
import type { IconName, Tone } from '@jpb/ui';
import { CHECK_LABEL, CHECK_MEANING, STATUS_LABEL } from './engine';
import './fairness.css';

/* ------------------------------------------------------------ clipboard */

/** Copies text with the async Clipboard API, falling back to a hidden textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok: boolean;
  try {
    ok = typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (text: string, what: string) => {
      const ok = await copyText(text);
      toast.push(ok ? { tone: 'success', title: `${what} copied` } : { tone: 'warning', title: `Could not copy the ${what.toLowerCase()}`, description: 'Select the text and copy it by hand.' });
    },
    [toast],
  );
}

export function CopyButton({ text, what }: { text: string; what: string }) {
  const copy = useCopy();
  return <IconButton icon="layers" size="sm" label={`Copy ${what.toLowerCase()}`} onClick={() => void copy(text, what)} className="acr-fair-copy" />;
}

/** A hash / seed / id: monospace, breaks anywhere, full value selectable, copy button. */
export function HashValue({ value, what, emptyText = '—', className }: { value: string | null | undefined; what: string; emptyText?: ReactNode; className?: string }) {
  if (!value) return <span className="acr-fair-dim">{emptyText}</span>;
  return (
    <span className={cx('acr-fair-hash', className)}>
      <code className="acr-fair-hash__text">{value}</code>
      <CopyButton text={value} what={what} />
    </span>
  );
}

/* ------------------------------------------------------------ statuses */

const STATUS_TONE: Readonly<Record<FairnessCheckStatus | FairnessOverallStatus, Tone>> = {
  VERIFIED: 'positive',
  FAILED: 'danger',
  NOT_AVAILABLE: 'neutral',
  INCOMPLETE: 'warning',
};
const STATUS_ICON: Readonly<Record<FairnessCheckStatus | FairnessOverallStatus, IconName>> = {
  VERIFIED: 'check-circle',
  FAILED: 'x-circle',
  NOT_AVAILABLE: 'minus',
  INCOMPLETE: 'warning',
};

/** VERIFIED / FAILED / NOT AVAILABLE / INCOMPLETE — always icon + text. */
export function VerdictPill({ status, size = 'md', title }: { status: FairnessCheckStatus | FairnessOverallStatus; size?: 'sm' | 'md'; title?: string }) {
  return <StatusPill tone={STATUS_TONE[status]} icon={STATUS_ICON[status]} label={STATUS_LABEL[status]} size={size} title={title} className={`acr-fair-verdict acr-fair-verdict--${status.toLowerCase()}`} />;
}

/** The four checks SEED COMMITMENT · DECK HASH · HOLE CARDS · BOARD with their verdicts. */
export function CheckList({ checks, compact = false }: { checks: readonly FairnessCheckResult[]; compact?: boolean }) {
  return (
    <ol className={cx('acr-fair-checks', compact && 'acr-fair-checks--compact')} aria-label="Verification checks">
      {checks.map((c, i) => (
        <li key={c.check} className={cx('acr-fair-check', `is-${c.status.toLowerCase()}`)}>
          <span className="acr-fair-check__step" aria-hidden="true">
            {i + 1}
          </span>
          <div className="acr-fair-check__body">
            <div className="acr-fair-check__head">
              <span className="acr-fair-check__name">{CHECK_LABEL[c.check]}</span>
              <VerdictPill status={c.status} size="sm" />
            </div>
            {!compact && <p className="acr-fair-check__meaning">{CHECK_MEANING[c.check]}</p>}
            <p className="acr-fair-check__detail">{c.detail}</p>
            {c.mismatches.length > 0 && (
              <table className="acr-fair-mismatch">
                <caption className="jpb-sr-only">Values that differ for {CHECK_LABEL[c.check]}</caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Published</th>
                    <th scope="col">Derived from the seed</th>
                  </tr>
                </thead>
                <tbody>
                  {c.mismatches.map((m, k) => (
                    <tr key={k}>
                      <th scope="row">{m.item}</th>
                      <td className="jpb-mono">{m.published}</td>
                      <td className="jpb-mono">{m.derived}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** One-line horizontal strip of the four checks (hand detail, lists). */
export function CheckStrip({ checks }: { checks: readonly FairnessCheckResult[] }) {
  return (
    <ul className="acr-fair-strip" aria-label="Verification checks">
      {checks.map((c) => (
        <li key={c.check} className={cx('acr-fair-strip__item', `is-${c.status.toLowerCase()}`)} title={c.detail}>
          <span className="acr-fair-strip__name">{CHECK_LABEL[c.check]}</span>
          <VerdictPill status={c.status} size="sm" />
        </li>
      ))}
    </ul>
  );
}
