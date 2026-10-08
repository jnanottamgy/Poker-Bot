import type { TournamentOverviewDto, TournamentStatus } from '@jpb/shared-types';
import { Button, Icon, Panel, TOURNAMENT_STATUS_META, cx } from '@jpb/ui';
import { usePermission } from '../../auth/permissions';
import type { TournamentControls } from '../../danger/useTournamentControls';
import { MAIN_PATH, SIDE_STATES, controlFor } from './transitions';
import type { TransitionControl } from './transitions';

function StateNode({ status, current, allowed, visited }: { status: TournamentStatus; current: boolean; allowed: boolean; visited: boolean }) {
  const m = TOURNAMENT_STATUS_META[status];
  return (
    <li className={cx('acr-fsm__node', `is-${m.tone}`, current && 'is-current', allowed && 'is-allowed', visited && 'is-visited')} aria-current={current ? 'step' : undefined}>
      <Icon name={m.icon} />
      <span className="acr-fsm__label">{m.label}</span>
      {current && <span className="acr-fsm__flag">NOW</span>}
      {!current && allowed && <span className="acr-fsm__flag acr-fsm__flag--next">NEXT</span>}
      {!current && visited && !allowed && (
        <span className="acr-fsm__done">
          <Icon name="check" />
          <span className="jpb-sr-only"> done</span>
        </span>
      )}
    </li>
  );
}

function TransitionButton({ control, controls, breakSeconds }: { control: Extract<TransitionControl, { kind: 'action' }>; controls: TournamentControls; breakSeconds: number }) {
  const allowed = usePermission(control.permission);
  return (
    <Button size="sm" variant={control.danger ? 'danger' : 'secondary'} icon={control.icon} disabled={!allowed} title={allowed ? undefined : `Requires ${control.permission}`} onClick={() => void control.run(controls, breakSeconds)}>
      {control.label}
    </Button>
  );
}

/** FSM diagram (current state highlighted) with the legal transitions as buttons. */
export function FsmPanel({ overview, controls }: { overview: TournamentOverviewDto; controls: TournamentControls }) {
  const status = overview.status;
  const allowed = new Set(overview.allowedTransitions);
  const mainIndex = MAIN_PATH.indexOf(status === 'BREAK' || status === 'PAUSED' ? (overview.resumeTo ?? 'RUNNING') : status);
  const visited = (s: TournamentStatus) => MAIN_PATH.indexOf(s) >= 0 && MAIN_PATH.indexOf(s) < mainIndex;
  const actions = overview.allowedTransitions.map((to) => ({ to, c: controlFor(status, to, overview.resumeTo) })).filter((x): x is { to: TournamentStatus; c: TransitionControl } => x.c !== null);
  const breakSeconds = overview.config.breaks[0]?.durationSeconds ?? 600;
  const auto = actions.filter((a) => a.c.kind === 'auto');
  const buttons = actions.filter((a) => a.c.kind === 'action' && a.to !== 'CANCELLED');
  const cancel = actions.find((a) => a.to === 'CANCELLED');

  return (
    <Panel
      title="Tournament state"
      icon="activity"
      description={`Now ${TOURNAMENT_STATUS_META[status].label.toLowerCase()}${overview.frozen ? ' · EMERGENCY FREEZE active' : ''}${overview.resumeTo && (status === 'PAUSED' || status === 'BREAK') ? ` · returns to ${TOURNAMENT_STATUS_META[overview.resumeTo].label.toLowerCase()}` : ''}`}
      className="acr-fsm-panel"
    >
      <div className="acr-fsm">
        <ol className="acr-fsm__main" aria-label="Tournament lifecycle">
          {MAIN_PATH.map((s) => (
            <StateNode key={s} status={s} current={s === status} allowed={allowed.has(s)} visited={visited(s)} />
          ))}
        </ol>
        <ul className="acr-fsm__side" aria-label="Side states">
          {SIDE_STATES.map((s) => (
            <StateNode key={s} status={s} current={s === status} allowed={allowed.has(s)} visited={false} />
          ))}
        </ul>
      </div>
      <div className="acr-fsm__actions">
        <span className="acr-fsm__actions-label">Allowed now</span>
        {buttons.map((a) => a.c.kind === 'action' && <TransitionButton key={a.to} control={a.c} controls={controls} breakSeconds={breakSeconds} />)}
        {auto.map((a) => (
          <span key={a.to} className="acr-fsm__auto" title="Johnny, the tournament director, makes this transition when the rules say so">
            <Icon name="zap" /> {a.c.label}
          </span>
        ))}
        {buttons.length === 0 && auto.length === 0 && !cancel && <span className="acr-fsm__auto">No further transitions — this state is final.</span>}
        {cancel && cancel.c.kind === 'action' && (
          <span className="acr-fsm__cancel">
            <TransitionButton control={cancel.c} controls={controls} breakSeconds={breakSeconds} />
          </span>
        )}
      </div>
    </Panel>
  );
}
