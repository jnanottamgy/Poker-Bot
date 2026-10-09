import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { TournamentOverviewDto, TournamentStatus } from '@jpb/shared-types';
import { Alert, Button, ErrorState, Icon, Skeleton, TournamentStatusPill, formatCount } from '@jpb/ui';
import { jsonEqual } from '@jpb/validation';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useDangerousAction } from '../../danger/DangerProvider';
import type { WizardEnv } from './components/context';
import { ConfigSummary } from './components/Summary';
import type { CreatedState } from './CreateSetup';
import { draftFromConfig } from './model/draft';
import { loadDraft, storageKey } from './model/storage';
import { useWizardState } from './useWizardState';
import { Wizard } from './Wizard';

/** The whole configuration may change only before registration closes (PUT /config). */
export const EDITABLE_STATUSES: readonly TournamentStatus[] = ['DRAFT', 'REGISTRATION'];
const OVERVIEW_POLL_MS = 30_000;
/** Changes listed in the save confirmation before "and N more". */
const LISTED_CHANGES = 8;

function SetupSkeleton() {
  return (
    <div className="acr-page acr-setup" aria-busy="true" aria-label="Loading tournament setup">
      <Skeleton width="30%" height={30} />
      <div className="acr-setup-layout">
        <Skeleton shape="block" height={420} />
        <Skeleton shape="block" height={620} />
      </div>
    </div>
  );
}

function SeedHash({ hash }: { hash: string }) {
  return (
    <p className="acr-setup-seed">
      <span className="acr-setup-seed__label">Server seed hash (SHA-256) — the fairness commitment</span>
      <code className="acr-setup-seed__hash jpb-mono">{hash}</code>
    </p>
  );
}

/** /t/:id/setup — edit before registration closes, otherwise a read-only summary. */
export function EditSetup({ tournamentId }: { tournamentId: string }) {
  const api = useApi();
  const overview = useQuery(qk.overview(tournamentId), (s) => api.tournaments.overview(tournamentId, s), { pollMs: OVERVIEW_POLL_MS });
  const canEdit = usePermission('TOURNAMENT_EDIT_CONFIG', tournamentId);
  const o = overview.data;
  if (overview.isLoading) return <SetupSkeleton />;
  if (!o) return <ErrorState title="Could not load the tournament setup" description={friendlyError(overview.error).description} onRetry={() => void overview.refetch()} />;
  if (!EDITABLE_STATUSES.includes(o.status) || !canEdit) return <LockedSetup overview={o} />;
  return <EditWizard key={tournamentId} overview={o} />;
}

function LockedSetup({ overview: o }: { overview: TournamentOverviewDto }) {
  const editable = EDITABLE_STATUSES.includes(o.status);
  return (
    <div className="acr-page acr-setup">
      <PageHeader
        title="Tournament setup"
        icon="sliders"
        eyebrow={o.name}
        description="The configuration this tournament runs with."
        actions={
          <>
            <ButtonLink to={sectionHref('clock', o.id)} icon="clock">
              Clock &amp; Structure
            </ButtonLink>
            <ButtonLink to={sectionHref('settings', o.id)} icon="sliders">
              Settings
            </ButtonLink>
          </>
        }
      />
      <div className="acr-setup-locked" role="note" aria-label="Configuration locked">
        <Icon name="lock" className="acr-setup-locked__icon" />
        <div>
          <p className="acr-setup-locked__title">
            {editable ? 'Read-only: you cannot edit this configuration' : 'The configuration is locked'} <TournamentStatusPill status={o.status} size="sm" />
          </p>
          <p className="acr-setup-locked__text">
            {editable
              ? 'Editing requires the TOURNAMENT_EDIT_CONFIG permission.'
              : 'Once registration closes only the settings in MUTABLE_WHILE_RUNNING may change (danger level 2, reason required): future blind levels and breaks in Clock & Structure; action timers, spectators and feature flags in Settings.'}
          </p>
        </div>
      </div>
      {o.serverSeedHash && <SeedHash hash={o.serverSeedHash} />}
      <ConfigSummary config={o.config} />
    </div>
  );
}

function EditWizard({ overview: o }: { overview: TournamentOverviewDto }) {
  const api = useApi();
  const danger = useDangerousAction();
  const location = useLocation();
  const navigate = useNavigate();
  const canOpen = usePermission('TOURNAMENT_LIFECYCLE', o.id);
  const key = storageKey(o.id);
  const [init] = useState(() => {
    const stored = loadDraft(key);
    if (stored?.base) return { draft: stored.draft, base: stored.base, restored: true };
    return { draft: draftFromConfig(o.config), base: o.config, restored: false };
  });
  const env: WizardEnv = useMemo(
    () => ({ mode: 'edit', tournamentId: o.id, status: o.status, liveJoinCode: o.joinCode, serverSeedHash: o.serverSeedHash || null }),
    [o.id, o.status, o.joinCode, o.serverSeedHash],
  );
  const state = useWizardState({ draft: init.draft, base: init.base, storageKey: key, env });
  const { validation, changes, draft, base } = state;
  const created = (location.state as CreatedState | null)?.setupCreated ?? null;
  const [restoredBanner, setRestoredBanner] = useState(init.restored);

  // Someone saved the configuration meanwhile: adopt it silently when there are no local edits.
  const serverChanged = base !== null && !jsonEqual(o.config, base);
  const hasEdits = (changes?.length ?? 0) > 0;
  useEffect(() => {
    if (serverChanged && !hasEdits) state.syncBase(o.config, true);
  }, [serverChanged, hasEdits, o.config]);

  const config = validation.normalized ?? draft.config;
  const list = changes ?? [];
  const invalidate = [qk.tournament(o.id), qk.tournamentsAll()];
  const isDraft = o.status === 'DRAFT';
  const registered = o.counters.registered;

  const put = async (reason: string) => {
    try {
      await api.tournaments.putConfig(o.id, reason ? { config, reason } : { config });
    } catch (err) {
      state.reportSaveError(err);
      throw err;
    }
    state.markSaved(draft.config);
  };
  const consequences = [
    ...list.slice(0, LISTED_CHANGES).map((c) => `${c.label}: ${c.before} → ${c.after}`),
    ...(list.length > LISTED_CHANGES ? [`… and ${list.length - LISTED_CHANGES} more change${list.length - LISTED_CHANGES === 1 ? '' : 's'}`] : []),
    ...(!isDraft && registered > 0 ? [`Applies to the ${formatCount(registered)} players already registered`] : []),
  ];

  const save = () =>
    void danger({
      level: 1,
      endpoint: 'tournamentPutConfig',
      title: 'Save configuration',
      summary: `${list.length} change${list.length === 1 ? '' : 's'} to “${o.name}”. The server validates the whole configuration again and writes an audit entry.`,
      consequences,
      reason: 'optional',
      confirmLabel: 'Save changes',
      run: ({ reason }) => put(reason),
      success: 'Configuration saved',
      invalidate,
    });

  const saveAndOpen = () =>
    void danger({
      level: 1,
      endpoint: 'registrationOpen',
      title: 'Save and open registration',
      summary: hasEdits ? `Saves ${list.length} change${list.length === 1 ? '' : 's'}, then opens registration.` : 'Opens registration with the saved configuration.',
      consequences: [...consequences, `Players can register with join code ${o.joinCode} or the QR code`],
      reason: 'optional',
      confirmLabel: hasEdits ? 'Save and open' : 'Open registration',
      run: async ({ reason }) => {
        if (hasEdits) await put(reason);
        await api.lifecycle.openRegistration(o.id, reason ? { reason } : {});
      },
      success: 'Registration is open',
      invalidate,
    });

  const blocked = !validation.ok;
  const actions = (
    <>
      <Button variant={isDraft ? 'secondary' : 'primary'} icon="check" disabled={blocked || !hasEdits} onClick={save}>
        Save changes
      </Button>
      {isDraft && canOpen && (
        <Button variant="primary" icon="play" disabled={blocked} onClick={saveAndOpen}>
          {hasEdits ? 'Save & open registration' : 'Open registration'}
        </Button>
      )}
    </>
  );
  const status = (
    <span className={blocked ? 'acr-setup-savebar__bad' : 'acr-setup-savebar__ok'}>
      <Icon name={blocked ? 'warning' : hasEdits ? 'info' : 'check-circle'} />
      {blocked ? `${validation.issues.length} problem${validation.issues.length === 1 ? '' : 's'} before you can save` : hasEdits ? `${list.length} unsaved change${list.length === 1 ? '' : 's'}` : 'Saved — no changes'}
      {hasEdits && !state.storageOk && <span className="acr-setup-dim"> · too large to keep in this tab — save soon</span>}
    </span>
  );

  const banners = (
    <>
      {created && (
        <Alert
          severity="SUCCESS"
          title={created.opened ? 'Tournament created — registration is open' : 'Tournament created as a draft'}
          onDismiss={() => navigate(location.pathname, { replace: true, state: null })}
          actions={
            <>
              <ButtonLink to={sectionHref('overview', o.id)} icon="activity" variant="primary">
                Open control room
              </ButtonLink>
              <ButtonLink to={sectionHref('registration', o.id)} icon="user">
                Registration
              </ButtonLink>
            </>
          }
        >
          <p>
            Join code <strong className="jpb-mono">{o.joinCode}</strong>. {created.openError ? `Registration could not be opened (${created.openError}); open it from Registration.` : ''} Publish the fairness commitment below before the first hand — the seed is revealed
            after the tournament.
          </p>
          {o.serverSeedHash && <SeedHash hash={o.serverSeedHash} />}
        </Alert>
      )}
      {restoredBanner && hasEdits && (
        <div className="acr-setup-banner" role="status">
          <Icon name="refresh" />
          <span>Restored your unsaved changes from this browser tab.</span>
          <Button size="sm" variant="ghost" onClick={() => state.replaceDraft(draftFromConfig(base ?? o.config, draft.step), 'Discarded the restored changes')}>
            Discard them
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRestoredBanner(false)}>
            Dismiss
          </Button>
        </div>
      )}
      {serverChanged && hasEdits && (
        <Alert
          severity="WARNING"
          title="The configuration was changed on the server meanwhile"
          actions={
            <>
              <Button size="sm" onClick={() => state.syncBase(o.config, true)}>
                Load the server version
              </Button>
              <Button size="sm" variant="ghost" onClick={() => state.syncBase(o.config, false)}>
                Keep my edits
              </Button>
            </>
          }
        >
          Someone saved a different configuration after you started editing. Saving your edits would replace it.
        </Alert>
      )}
      {o.status === 'REGISTRATION' && (
        <p className="acr-setup-banner is-info">
          <Icon name="info" /> Registration is open ({formatCount(registered)} registered). Changes apply to everyone already registered; the configuration locks when registration closes.
        </p>
      )}
    </>
  );

  return (
    <div className="acr-page acr-setup">
      <PageHeader
        title="Tournament setup"
        icon="sliders"
        eyebrow={
          <>
            {o.name} · <TournamentStatusPill status={o.status} size="sm" />
          </>
        }
        description="Edit any step; nothing changes on the server until you save. The configuration locks when registration closes."
        actions={
          <>
            {hasEdits && (
              <Button size="sm" variant="ghost" icon="x" onClick={() => state.replaceDraft(draftFromConfig(base ?? o.config, draft.step), 'Discarded your unsaved changes')}>
                Discard changes
              </Button>
            )}
            <ButtonLink to={sectionHref('overview', o.id)} icon="activity">
              Overview
            </ButtonLink>
          </>
        }
      />
      <Wizard state={state} banners={banners} actions={actions} status={status} />
    </div>
  );
}
