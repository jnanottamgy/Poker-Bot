import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, EmptyState, Icon } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { PageHeader } from '../../components/PageHeader';
import { ButtonLink } from '../../components/ButtonLink';
import { useDangerousAction } from '../../danger/DangerProvider';
import { formatAgo } from '../../lib/time';
import type { WizardEnv } from './components/context';
import { newDraft } from './model/draft';
import { clearDraft, loadDraft, storageKey } from './model/storage';
import { StartFrom } from './StartFrom';
import { useWizardState } from './useWizardState';
import { Wizard } from './Wizard';

/** Router state handed to the edit wizard right after creation (shows the seed hash banner). */
export interface CreatedState {
  setupCreated: { opened: boolean; openError: string | null };
}

const CREATE_ENV: WizardEnv = { mode: 'create', tournamentId: null, status: null, liveJoinCode: null, serverSeedHash: null };

/** /tournaments/new — the wizard for a tournament that does not exist yet. */
export function CreateSetup() {
  const canCreate = usePermission('TOURNAMENT_CREATE', null);
  if (!canCreate) {
    return (
      <div className="acr-page acr-setup">
        <PageHeader title="New tournament" icon="plus" />
        <EmptyState icon="lock" title="You cannot create tournaments" description="Creating a tournament requires the TOURNAMENT_CREATE permission. Ask a super admin." action={<ButtonLink to="/tournaments">Back to tournaments</ButtonLink>} />
      </div>
    );
  }
  return <CreateWizard />;
}

function CreateWizard() {
  const api = useApi();
  const navigate = useNavigate();
  const danger = useDangerousAction();
  const canOpen = usePermission('TOURNAMENT_LIFECYCLE', null);
  const key = storageKey(null);
  const [restored] = useState(() => loadDraft(key));
  const initial = useMemo(() => restored?.draft ?? newDraft(), [restored]);
  const [restoredBanner, setRestoredBanner] = useState(restored !== null);
  const state = useWizardState({ draft: initial, base: null, storageKey: key, env: CREATE_ENV });
  const { validation, draft } = state;
  const config = validation.normalized ?? draft.config;

  const finish = (id: string, opened: boolean, openError: string | null) => {
    state.forgetStoredDraft();
    const routerState: CreatedState = { setupCreated: { opened, openError } };
    navigate(sectionHref('setup', id), { state: routerState });
  };

  const create = async () => {
    try {
      return await api.tournaments.create(config);
    } catch (err) {
      state.reportSaveError(err);
      throw err;
    }
  };

  const saveDraft = () =>
    void danger({
      level: 0,
      endpoint: 'tournamentCreate',
      title: 'Create tournament',
      run: create,
      success: (r) => `Draft “${r.tournament.name}” created`,
      invalidate: [qk.tournamentsAll()],
      onSuccess: (r) => finish(r.tournament.id, false, null),
    });

  const saveAndOpen = () =>
    void danger({
      level: 1,
      endpoint: 'registrationOpen',
      title: 'Create and open registration',
      summary: `Creates “${config.name}” and opens registration right away.`,
      consequences: [
        <>
          Players can register with join code <strong className="jpb-mono">{config.joinCode}</strong> or the QR code
        </>,
        config.registration.requireApproval ? 'Each registration waits for staff approval' : 'Registrations count immediately (no approval step)',
        'The structure can still be edited until registration closes',
      ],
      confirmLabel: 'Create and open',
      run: async ({ reason }) => {
        const created = await create();
        try {
          await api.lifecycle.openRegistration(created.tournament.id, reason ? { reason } : {});
          return { created, openError: null as string | null };
        } catch (err) {
          return { created, openError: err instanceof Error ? err.message : 'Registration could not be opened.' };
        }
      },
      success: (r) => (r.openError ? `Draft “${r.created.tournament.name}” created` : `“${r.created.tournament.name}” created — registration is open`),
      invalidate: [qk.tournamentsAll()],
      onSuccess: (r) => finish(r.created.tournament.id, r.openError === null, r.openError),
    });

  const blocked = !validation.ok;
  const actions = (
    <>
      <Button icon="file" disabled={blocked} onClick={saveDraft} title={blocked ? 'Fix the problems first' : undefined}>
        Save draft
      </Button>
      {canOpen && (
        <Button variant="primary" icon="play" disabled={blocked} onClick={saveAndOpen} title={blocked ? 'Fix the problems first' : undefined}>
          Save &amp; open registration
        </Button>
      )}
    </>
  );
  const status = (
    <span className={blocked ? 'acr-setup-savebar__bad' : 'acr-setup-savebar__ok'}>
      <Icon name={blocked ? 'warning' : 'check-circle'} />
      {blocked ? `${validation.issues.length} problem${validation.issues.length === 1 ? '' : 's'} before you can save` : 'Valid — ready to create'}
      <span className="acr-setup-dim"> · {state.storageOk ? 'Draft kept in this browser tab' : 'Too large to keep in this tab — save soon'}</span>
    </span>
  );
  const startOver = () => {
    clearDraft(key);
    setRestoredBanner(false);
    state.replaceDraft(newDraft(), 'Started over from the defaults');
  };

  const banners = (
    <>
      {restoredBanner && restored && (
        <div className="acr-setup-banner" role="status">
          <Icon name="refresh" />
          <span>
            Restored the unsaved draft from this tab{restored.savedAt ? ` (last change ${formatAgo(Date.now() - restored.savedAt)})` : ''}.
          </span>
          <Button size="sm" variant="ghost" onClick={startOver}>
            Start over
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRestoredBanner(false)}>
            Dismiss
          </Button>
        </div>
      )}
      <StartFrom onCopy={(d, from) => state.replaceDraft({ ...d, step: state.draft.step }, `Copied the configuration of “${from}”`)} />
    </>
  );

  return (
    <div className="acr-page acr-setup">
      <PageHeader
        title="New tournament"
        icon="plus"
        eyebrow="Tournaments"
        description="Ten steps, every one optional to visit: the defaults already make a valid tournament. Problems are checked as you type with the same rules the server uses."
        actions={
          <>
            <Button size="sm" variant="ghost" icon="refresh" onClick={startOver}>
              Start over
            </Button>
            <ButtonLink to="/tournaments" icon="chevron-left">
              Tournaments
            </ButtonLink>
          </>
        }
      />
      <Wizard state={state} banners={banners} actions={actions} status={status} />
    </div>
  );
}
