import type { ReactNode } from 'react';
import { Icon, cx } from '@jpb/ui';
import { useWizard } from '../components/context';
import { Group } from '../components/Group';
import { IssueList } from '../components/IssueList';
import { ConfigSummary } from '../components/Summary';
import type { ConfigChange } from '../model/diff';
import { stepDef } from '../model/steps';

export interface ReviewStepProps {
  /** Edit mode: what differs from the saved configuration. */
  changes: readonly ConfigChange[] | null;
  /** Extra buttons in the verdict (the sticky save bar always has the save actions). */
  actions?: ReactNode;
}

/** Step 10 — full summary, validation result, unsaved changes, fairness commitment and the save actions. */
export function ReviewStep({ changes, actions }: ReviewStepProps) {
  const { config, validation, env, goToStep } = useWizard();
  const ok = validation.ok;
  return (
    <>
      <section className={cx('acr-setup-verdict', ok ? 'is-ok' : 'is-bad')} aria-label="Validation result">
        <Icon name={ok ? 'check-circle' : 'warning'} className="acr-setup-verdict__icon" />
        <div className="acr-setup-verdict__text">
          <p className="acr-setup-verdict__title">{ok ? 'Ready to save' : `${validation.issues.length} problem${validation.issues.length === 1 ? '' : 's'} to fix before saving`}</p>
          <p className="acr-setup-verdict__desc">
            {ok
              ? 'The configuration passes the same validation the server runs (@jpb/validation). The server checks it again when you save.'
              : 'Select a problem to jump to its field. Nothing is sent to the server until every problem is fixed.'}
          </p>
        </div>
        {actions && <div className="acr-setup-verdict__actions">{actions}</div>}
      </section>
      <IssueList issues={validation.issues} showStep label="Problems" />

      {changes !== null && (
        <Group title="Unsaved changes" icon="list" description={changes.length === 0 ? 'Nothing changed since the last save.' : 'Compared with the configuration saved on the server.'}>
          {changes.length > 0 && (
            <table className="acr-setup-mini acr-setup-changes" aria-label="Unsaved changes">
              <thead>
                <tr>
                  <th scope="col">Setting</th>
                  <th scope="col">Saved</th>
                  <th scope="col">New</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.path}>
                    <td>
                      <button type="button" className="acr-setup-linkbtn" onClick={() => goToStep(c.step)}>
                        {stepDef(c.step).title} · {c.label}
                      </button>
                    </td>
                    <td className="acr-setup-dim">{c.before}</td>
                    <td>{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Group>
      )}

      <Group title="Fairness commitment" icon="shield" description="Every deck is shuffled from a secret server seed. Its SHA-256 hash is published before the first hand; the seed is revealed after the tournament so anyone can verify every shuffle.">
        {env.serverSeedHash ? (
          <p className="acr-setup-seed">
            <span className="acr-setup-seed__label">Server seed hash (SHA-256)</span>
            <code className="acr-setup-seed__hash jpb-mono">{env.serverSeedHash}</code>
          </p>
        ) : (
          <p className="acr-setup-dim">
            <Icon name="lock" /> The server generates the secret seed when the draft is created; its hash appears here and on the join page.
          </p>
        )}
      </Group>

      <ConfigSummary config={config} countByStep={validation.countByStep} onEdit={goToStep} />
    </>
  );
}
