import { Icon, cx } from '@jpb/ui';
import type { WizardIssue } from '../model/issues';
import { stepDef } from '../model/steps';
import { useWizard } from './context';

export interface IssueListProps {
  issues: readonly WizardIssue[];
  /** Prefix each issue with its step name (Review / summary lists). */
  showStep?: boolean;
  /** Only the first N, then "and N more". */
  limit?: number;
  label: string;
  className?: string;
}

/** Problems as links: activating one opens its step and focuses the field. */
export function IssueList({ issues, showStep = false, limit, label, className }: IssueListProps) {
  const { goToIssue } = useWizard();
  if (issues.length === 0) return null;
  const shown = limit === undefined ? issues : issues.slice(0, limit);
  const more = issues.length - shown.length;
  return (
    <div className={cx('acr-setup-issues', className)}>
      <ul className="acr-setup-issues__list" aria-label={label}>
        {shown.map((issue) => (
          <li key={issue.key}>
            <button type="button" className="acr-setup-issues__item" onClick={() => goToIssue(issue)}>
              <Icon name="warning" className="acr-setup-issues__icon" />
              <span className="acr-setup-issues__text">
                <span className="acr-setup-issues__label">
                  {showStep && <span className="acr-setup-issues__step">{stepDef(issue.step).title} · </span>}
                  {issue.label}
                  {issue.source === 'server' && <span className="acr-setup-issues__server"> (server)</span>}
                </span>
                <span className="acr-setup-issues__msg">{issue.message}</span>
              </span>
              <Icon name="arrow-right" className="acr-setup-issues__go" />
            </button>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="acr-setup-issues__more">and {more} more problem{more === 1 ? '' : 's'}</p>}
    </div>
  );
}
