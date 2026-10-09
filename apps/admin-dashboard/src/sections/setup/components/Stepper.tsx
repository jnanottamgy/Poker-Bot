import { Icon, cx } from '@jpb/ui';
import { STEPS } from '../model/steps';
import type { StepId } from '../model/steps';

export interface StepperProps {
  current: StepId;
  countByStep: Readonly<Record<StepId, number>>;
  /** Steps whose content differs from the starting point (edit mode). */
  changedSteps?: ReadonlySet<StepId>;
  onSelect: (step: StepId) => void;
}

/**
 * Vertical step navigation (horizontal strip on narrow screens). Every step
 * is reachable at any time; its state is icon + text, never color alone.
 */
export function Stepper({ current, countByStep, changedSteps, onSelect }: StepperProps) {
  return (
    <nav className="acr-setup-stepper" aria-label="Setup steps">
      <ol className="acr-setup-stepper__list">
        {STEPS.map((s, i) => {
          const problems = s.id === 'review' ? 0 : countByStep[s.id];
          const isCurrent = s.id === current;
          const changed = changedSteps?.has(s.id) ?? false;
          const stateText = problems > 0 ? `${problems} problem${problems === 1 ? '' : 's'}` : s.id === 'review' ? 'Summary' : changed ? 'Changed' : 'OK';
          return (
            <li key={s.id}>
              <button
                type="button"
                className={cx('acr-setup-stepper__item', isCurrent && 'is-current', problems > 0 && 'has-problems', changed && 'is-changed')}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => onSelect(s.id)}
              >
                <span className="acr-setup-stepper__num" aria-hidden="true">
                  {problems > 0 ? <Icon name="warning" /> : isCurrent ? i + 1 : <Icon name={s.id === 'review' ? 'list' : 'check'} />}
                </span>
                <span className="acr-setup-stepper__text">
                  <span className="acr-setup-stepper__title">
                    <span className="jpb-sr-only">Step {i + 1}: </span>
                    {s.title}
                  </span>
                  <span className="acr-setup-stepper__state">{stateText}</span>
                </span>
                {changed && problems === 0 && <span className="acr-setup-stepper__dot" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
