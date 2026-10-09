import { useMemo, useState } from 'react';
import { Icon, Tabs, cx, formatCount } from '@jpb/ui';
import { diffJson, prettyJson } from './diff';
import type { DiffKind } from './diff';

const KIND: Readonly<Record<DiffKind, { label: string; sign: string }>> = {
  added: { label: 'Added', sign: '+' },
  removed: { label: 'Removed', sign: '−' },
  changed: { label: 'Changed', sign: '~' },
  same: { label: 'Unchanged', sign: '=' },
};

/**
 * Before → after viewer for an audit entry: a field-by-field diff (changed
 * fields first, unchanged ones on request) and the raw JSON side by side.
 */
export function DiffViewer({ before, after }: { before: unknown; after: unknown }) {
  const [view, setView] = useState<'diff' | 'raw'>('diff');
  const [showSame, setShowSame] = useState(false);
  const diff = useMemo(() => diffJson(before, after), [before, after]);
  const none = (before === null || before === undefined) && (after === null || after === undefined);

  if (none) {
    return (
      <p className="acr-audit-diff__none">
        <Icon name="info" /> This action records no before/after snapshot (the action, target and reason are the whole record).
      </p>
    );
  }
  const rows = showSame ? diff.rows : diff.rows.filter((r) => r.kind !== 'same');
  const same = diff.rows.length - diff.changed;

  return (
    <div className="acr-audit-diff">
      <Tabs
        variant="segmented"
        label="Change view"
        value={view}
        onChange={(v) => setView(v as 'diff' | 'raw')}
        tabs={[
          { id: 'diff', label: 'Changes', count: diff.changed },
          { id: 'raw', label: 'Raw JSON' },
        ]}
      >
        {view === 'diff' ? (
          <div className="acr-audit-diff__body">
            {rows.length === 0 ? (
              <p className="acr-audit-diff__none">
                <Icon name="check" /> Before and after are identical.
              </p>
            ) : (
              <table className="acr-audit-diff__table" aria-label="Field changes">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.path} className={cx('acr-audit-diff__row', `is-${r.kind}`)}>
                      <th scope="row">
                        <span className="acr-audit-diff__sign" aria-hidden="true">
                          {KIND[r.kind].sign}
                        </span>
                        <span className="jpb-sr-only">{KIND[r.kind].label}: </span>
                        <span className="jpb-mono">{r.path}</span>
                      </th>
                      <td className="jpb-mono acr-audit-diff__before">{r.before === '' ? <span className="acr-audit-dim">—</span> : r.before}</td>
                      <td className="jpb-mono acr-audit-diff__after">{r.after === '' ? <span className="acr-audit-dim">—</span> : r.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="acr-audit-diff__foot">
              {same > 0 && (
                <button type="button" className="acr-audit-textbtn" aria-pressed={showSame} onClick={() => setShowSame((v) => !v)}>
                  {showSame ? 'Hide' : 'Show'} {formatCount(same)} unchanged {same === 1 ? 'field' : 'fields'}
                </button>
              )}
              {diff.truncated && <span className="acr-audit-dim">Large snapshot: only the first fields are compared — see Raw JSON for everything.</span>}
            </div>
          </div>
        ) : (
          <div className="acr-audit-diff__raw">
            <figure>
              <figcaption>Before</figcaption>
              <pre className="jpb-mono" tabIndex={0} aria-label="Before state JSON">
                {prettyJson(before)}
              </pre>
            </figure>
            <figure>
              <figcaption>After</figcaption>
              <pre className="jpb-mono" tabIndex={0} aria-label="After state JSON">
                {prettyJson(after)}
              </pre>
            </figure>
          </div>
        )}
      </Tabs>
    </div>
  );
}
