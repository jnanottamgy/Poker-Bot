import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Icon, IconButton } from '@jpb/ui';
import { WizardContext } from './components/context';
import { IssueList } from './components/IssueList';
import { Stepper } from './components/Stepper';
import { STEPS, STEP_IDS, stepDef, stepIndex } from './model/steps';
import type { StepId } from './model/steps';
import { BalancingStep } from './steps/BalancingStep';
import { BasicsStep } from './steps/BasicsStep';
import { BlindsStep } from './steps/BlindsStep';
import { BreaksStep } from './steps/BreaksStep';
import { DisplayStep } from './steps/DisplayStep';
import { PlayersStep } from './steps/PlayersStep';
import { PrizesStep } from './steps/PrizesStep';
import { RegistrationStep } from './steps/RegistrationStep';
import { ReviewStep } from './steps/ReviewStep';
import { TimingStep } from './steps/TimingStep';
import type { WizardState } from './useWizardState';

/** Re-render period of "starts in …" on the Basics step. */
const NOW_TICK_MS = 30_000;
/** Problems of the current step listed above its fields. */
const STEP_ISSUE_LIMIT = 6;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(t);
  }, []);
  return now;
}

function StepBody({ step, now, review }: { step: StepId; now: number; review: ReactNode }) {
  switch (step) {
    case 'basics':
      return <BasicsStep now={now} />;
    case 'players':
      return <PlayersStep />;
    case 'blinds':
      return <BlindsStep />;
    case 'breaks':
      return <BreaksStep />;
    case 'timing':
      return <TimingStep />;
    case 'registration':
      return <RegistrationStep />;
    case 'prizes':
      return <PrizesStep />;
    case 'display':
      return <DisplayStep />;
    case 'balancing':
      return <BalancingStep />;
    case 'review':
      return <>{review}</>;
  }
}

export interface WizardProps {
  state: WizardState;
  /** Banners above the steps (restored draft, created, server changes…). */
  banners?: ReactNode;
  /** Save buttons (shown in the sticky bar and on the Review step). */
  actions: ReactNode;
  /** Left part of the sticky bar (what will happen on save). */
  status: ReactNode;
}

/** Stepper + current step + sticky save bar. Every step is reachable at any time. */
export function Wizard({ state, banners, actions, status }: WizardProps) {
  const now = useNow();
  const { context, draft, validation, changes, changedSteps, undo } = state;
  const step = draft.step;
  const idx = stepIndex(step);
  const def = stepDef(step);
  const prev = idx > 0 ? STEPS[idx - 1] : null;
  const next = idx < STEP_IDS.length - 1 ? STEPS[idx + 1] : null;
  const stepIssues = step === 'review' ? [] : validation.issues.filter((i) => i.step === step);

  return (
    <WizardContext.Provider value={context}>
      {banners}
      <div className="acr-setup-layout">
        <aside className="acr-setup-aside">
          <Stepper current={step} countByStep={validation.countByStep} changedSteps={changedSteps} onSelect={context.goToStep} />
        </aside>
        <div className="acr-setup-main">
          <header className="acr-setup-stephead">
            <p className="acr-setup-stephead__num">
              Step {idx + 1} of {STEP_IDS.length}
            </p>
            <h3 id="setup-step-title" className="acr-setup-stephead__title" tabIndex={-1}>
              <Icon name={def.icon} /> {def.title}
            </h3>
            <p className="acr-setup-stephead__desc">{def.description}</p>
          </header>
          {undo && (
            <div className="acr-setup-undo" role="status">
              <Icon name="info" />
              <span className="acr-setup-undo__text">{undo.label}.</span>
              <Button size="sm" icon="refresh" onClick={state.applyUndo}>
                Undo
              </Button>
              <IconButton icon="x" size="sm" variant="ghost" label="Dismiss" onClick={state.dismissUndo} />
            </div>
          )}
          {stepIssues.length > 0 && (
            <div className="acr-setup-stepissues" role="region" aria-label="Problems on this step">
              <p className="acr-setup-stepissues__title">
                <Icon name="warning" /> {stepIssues.length} problem{stepIssues.length === 1 ? '' : 's'} on this step
              </p>
              <IssueList issues={stepIssues} limit={STEP_ISSUE_LIMIT} label="Problems on this step" />
            </div>
          )}
          <div className="acr-setup-stepbody" key={step}>
            <StepBody step={step} now={now} review={<ReviewStep changes={changes} />} />
          </div>
          <nav className="acr-setup-stepnav" aria-label="Step navigation">
            {prev ? (
              <Button icon="chevron-left" onClick={() => context.goToStep(prev.id)}>
                Back: {prev.title}
              </Button>
            ) : (
              <span />
            )}
            {next && (
              <Button variant={next.id === 'review' ? 'primary' : 'secondary'} iconRight="chevron-right" onClick={() => context.goToStep(next.id)}>
                Next: {next.title}
              </Button>
            )}
          </nav>
        </div>
      </div>
      <div className="acr-setup-savebar" role="region" aria-label="Save">
        <div className="acr-setup-savebar__status">{status}</div>
        {validation.issues.length > 0 && (
          <Button size="sm" variant="ghost" icon="warning" onClick={() => context.goToIssue(validation.issues[0]!)}>
            Fix {validation.issues.length} problem{validation.issues.length === 1 ? '' : 's'}
          </Button>
        )}
        <div className="acr-setup-savebar__actions">{actions}</div>
      </div>
    </WizardContext.Provider>
  );
}
