import { useNavigate } from 'react-router';
import { Button, Icon, Kbd } from '@jpb/ui';
import { sectionHref } from '../app/sections';
import { usePermission } from '../auth/permissions';
import type { TournamentControls } from '../danger/useTournamentControls';
import type { TournamentState } from '../live/useTournamentState';
import { AdminMenu } from './AdminMenu';

const PAUSABLE = ['RUNNING', 'FINAL_TABLE', 'BREAK'];

export interface TopActionsProps {
  tournamentId: string | null;
  state: TournamentState;
  controls: TournamentControls;
  openAlerts: number;
  onSearch: () => void;
  onShortcuts: () => void;
}

/** Search, alerts bell, PAUSE AFTER HAND, EMERGENCY FREEZE and the admin menu. */
export function TopActions({ tournamentId, state, controls, openAlerts, onSearch, onShortcuts }: TopActionsProps) {
  const navigate = useNavigate();
  const canPause = usePermission('TOURNAMENT_PAUSE', tournamentId);
  const canFreeze = usePermission('TOURNAMENT_FREEZE', tournamentId);
  const status = state.status;
  const paused = status === 'PAUSED';
  const inPlay = status !== null && (PAUSABLE.includes(status) || paused);

  return (
    <>
      <button type="button" className="acr-searchbtn" onClick={onSearch} aria-keyshortcuts="/">
        <Icon name="search" />
        <span className="acr-searchbtn__text">Search</span>
        <Kbd>/</Kbd>
      </button>
      {tournamentId && (
        <button
          type="button"
          className="acr-bell"
          onClick={() => navigate(sectionHref('alerts', tournamentId))}
          aria-label={openAlerts > 0 ? `Alerts: ${openAlerts} open` : 'Alerts: none open'}
          title={openAlerts > 0 ? `${openAlerts} open alerts` : 'No open alerts'}
        >
          <Icon name="bell" />
          {openAlerts > 0 && (
            <span className="acr-bell__count jpb-num" aria-hidden="true">
              {openAlerts > 99 ? '99+' : openAlerts}
            </span>
          )}
        </button>
      )}
      {tournamentId && inPlay && (
        <Button
          size="sm"
          variant={paused ? 'primary' : 'secondary'}
          icon={paused ? 'play' : 'pause'}
          disabled={!canPause || state.frozen}
          title={!canPause ? 'Requires TOURNAMENT_PAUSE' : undefined}
          onClick={() => void (paused ? controls.resume() : controls.pause())}
          className="acr-pausebtn"
        >
          {paused ? 'Resume' : 'Pause after hand'}
        </Button>
      )}
      {tournamentId && inPlay && (
        <Button
          size="sm"
          variant="danger"
          icon="freeze"
          disabled={!canFreeze}
          title={!canFreeze ? 'Requires TOURNAMENT_FREEZE' : undefined}
          onClick={() => void (state.frozen ? controls.unfreeze() : controls.freeze())}
          className="acr-freezebtn"
        >
          {state.frozen ? 'Unfreeze' : 'Emergency freeze'}
        </Button>
      )}
      <AdminMenu onShortcuts={onShortcuts} />
    </>
  );
}
