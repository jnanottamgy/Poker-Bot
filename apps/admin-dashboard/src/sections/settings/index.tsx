import { useEffect, useMemo, useState } from 'react';
import type { TournamentOverviewDto } from '@jpb/shared-types';
import { Badge, Button, ErrorState, Icon, Panel, Skeleton, TextField, Toggle, TournamentStatusPill, cx } from '@jpb/ui';
import { CONFIG_LIMITS, jsonEqual } from '@jpb/validation';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { useGate } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useDangerousAction } from '../../danger/DangerProvider';
import { FEATURE_INFO, SPECTATOR_INFO } from '../setup/model/features';
import type { FeatureInfo } from '../setup/model/features';
import { draftOf, runningChanges, saveMode, settingChanges, settingIssues, withSettings } from './model';
import type { SettingsDraft } from './model';
import './settings.css';

const OVERVIEW_POLL_MS = 15_000;

function SettingsSkeleton() {
  return (
    <div className="acr-page acr-settings" aria-busy="true" aria-label="Loading settings">
      <Skeleton width="24%" height={30} />
      <div className="acr-settings-grid">
        <Skeleton shape="block" height={320} />
        <Skeleton shape="block" height={320} />
      </div>
    </div>
  );
}

/** §2.21 Settings — per-tournament feature flags, spectator / display options and the players' default sound / haptics. */
export default function SettingsSection() {
  const tournamentId = useTournamentId();
  const api = useApi();
  const overview = useQuery(qk.overview(tournamentId), (s) => api.tournaments.overview(tournamentId, s), { pollMs: OVERVIEW_POLL_MS });
  const o = overview.data;
  if (overview.isLoading) return <SettingsSkeleton />;
  if (!o) return <ErrorState title="Could not load the settings" description={friendlyError(overview.error).description} onRetry={() => void overview.refetch()} />;
  return <SettingsEditor key={o.id} overview={o} stale={overview.isStale} />;
}

function FlagRow({ info, checked, disabled, changed, onChange }: { info: FeatureInfo; checked: boolean; disabled: boolean; changed: boolean; onChange: (v: boolean) => void }) {
  return (
    <li className={cx('acr-settings-flag', changed && 'is-changed')}>
      <Icon name={info.icon} className="acr-settings-flag__icon" />
      <Toggle id={`settings-${info.key}`} checked={checked} disabled={disabled} onChange={onChange} label={info.label} description={info.description} />
      {changed && <Badge tone="info">CHANGED</Badge>}
    </li>
  );
}

function SettingsEditor({ overview: o, stale }: { overview: TournamentOverviewDto; stale: boolean }) {
  const api = useApi();
  const danger = useDangerousAction();
  const gate = useGate('TOURNAMENT_EDIT_CONFIG', o.id);
  const mode = saveMode(o.status);
  const serverDraft = useMemo(() => draftOf(o.config), [o.config]);
  const [base, setBase] = useState(serverDraft);
  const [draft, setDraft] = useState(serverDraft);
  const [delayText, setDelayText] = useState(String(serverDraft.spectators.delaySeconds));
  const changes = settingChanges(base, draft);
  const dirty = changes.length > 0;
  const issues = useMemo(() => settingIssues(o.config, draft), [o.config, draft]);
  const readOnly = mode === 'ended' || !gate.allowed;
  const serverMoved = !jsonEqual(serverDraft, base);

  // Follow the server while nothing is being edited here (another admin, the Setup wizard…).
  useEffect(() => {
    if (serverMoved && !dirty) {
      setBase(serverDraft);
      setDraft(serverDraft);
      setDelayText(String(serverDraft.spectators.delaySeconds));
    }
  }, [serverMoved, dirty, serverDraft]);

  const setFeature = (key: keyof SettingsDraft['features'], v: boolean) => setDraft((d) => ({ ...d, features: { ...d.features, [key]: v } }));
  const setSpectator = (key: keyof SettingsDraft['spectators'], v: boolean | number) => setDraft((d) => ({ ...d, spectators: { ...d.spectators, [key]: v } }));
  const discard = () => {
    setDraft(base);
    setDelayText(String(base.spectators.delaySeconds));
  };
  const saved = () => setBase(draft);
  const invalidate = [qk.tournament(o.id), qk.tournamentsAll()];
  const preview = changes.map((c) => ({ label: c.label, before: c.before, after: c.after }));

  const save = () => {
    if (mode === 'config') {
      void danger({
        level: 1,
        endpoint: 'tournamentPutConfig',
        title: 'Save settings',
        summary: `${changes.length} setting${changes.length === 1 ? '' : 's'} of “${o.name}” change. The whole configuration is validated again by the server.`,
        consequences: changes.map((c) => `${c.label}: ${c.before} → ${c.after}`),
        reason: 'optional',
        confirmLabel: 'Save settings',
        run: ({ reason }) => api.tournaments.putConfig(o.id, reason ? { config: withSettings(o.config, draft), reason } : { config: withSettings(o.config, draft) }),
        success: 'Settings saved',
        invalidate,
        onSuccess: saved,
      });
      return;
    }
    void danger({
      level: 2,
      endpoint: 'tournamentPatchRunningConfig',
      word: 'EDIT',
      title: 'Change settings while running',
      summary: `The tournament is ${o.status.toLowerCase().replace(/_/g, ' ')}. The change applies immediately to every table, player and screen.`,
      consequences: [
        'Only feature flags and spectator settings are sent (MUTABLE_WHILE_RUNNING)',
        'Players’ sound / haptics defaults apply to devices that have not chosen their own',
        'A POLICIES_EDITED audit entry is written with your name, reason and before / after',
      ],
      preview,
      confirmLabel: 'Apply now',
      run: (d) => api.tournaments.patchRunningConfig(o.id, { ...d, changes: runningChanges(base, draft) }),
      success: 'Settings changed',
      invalidate,
      onSuccess: saved,
    });
  };

  const disabledFlag = readOnly;
  const tournamentFlags = FEATURE_INFO.filter((f) => f.scope === 'tournament');
  const playerFlags = FEATURE_INFO.filter((f) => f.scope === 'player');
  const changedKeys = new Set(changes.map((c) => c.key));
  const delayError = issues.get('spectators.delaySeconds');

  return (
    <div className={cx('acr-page acr-settings', stale && 'is-stale')}>
      <PageHeader
        title="Settings"
        icon="sliders"
        eyebrow={
          <>
            {o.name} · <TournamentStatusPill status={o.status} size="sm" />
          </>
        }
        description="Feature flags, spectator and display options, and what players’ phones do by default. Every change is permission-checked and written to the audit log."
        actions={
          <>
            {mode === 'config' && (
              <ButtonLink to={sectionHref('setup', o.id)} icon="sliders">
                Full setup
              </ButtonLink>
            )}
            <ButtonLink to={sectionHref('clock', o.id)} icon="clock">
              Clock &amp; Structure
            </ButtonLink>
          </>
        }
      />

      <div className={cx('acr-settings-mode', `is-${mode}`)} role="note" aria-label="How changes are saved">
        <Icon name={mode === 'running' ? 'shield' : mode === 'ended' ? 'lock' : 'info'} />
        <p>
          {mode === 'config' && 'Before registration closes these settings are saved with the configuration (one confirmation, optional reason).'}
          {mode === 'running' && (
            <>
              The tournament is under way: changes are <strong>danger level 2</strong> — type <span className="jpb-mono">EDIT</span> and give a reason. They apply immediately.
            </>
          )}
          {mode === 'ended' && 'The tournament has ended; its settings are shown for reference only.'}
          {mode !== 'ended' && !gate.allowed && ` Read-only: changing settings requires ${gate.lockedPermission}.`}
        </p>
      </div>

      <div className="acr-settings-grid">
        <Panel title="Feature flags" icon="sliders" description="Per-tournament switches.">
          <ul className="acr-settings-flags" aria-label="Feature flags">
            {tournamentFlags.map((f) => (
              <FlagRow key={f.key} info={f} checked={draft.features[f.key]} disabled={disabledFlag} changed={changedKeys.has(`features.${f.key}`)} onChange={(v) => setFeature(f.key, v)} />
            ))}
          </ul>
          {draft.features.lateRegistration && !o.config.lateRegistration.enabled && <p className="acr-settings-note">No late-registration window is configured, so this flag alone opens nothing.</p>}
        </Panel>

        <div className="acr-settings-col">
          <Panel title="Player defaults" icon="phone" description="Out-of-the-box sound and haptics on players’ phones. Each player can still change them on their own device.">
            <ul className="acr-settings-flags" aria-label="Player defaults">
              {playerFlags.map((f) => (
                <FlagRow key={f.key} info={f} checked={draft.features[f.key]} disabled={disabledFlag} changed={changedKeys.has(`features.${f.key}`)} onChange={(v) => setFeature(f.key, v)} />
              ))}
            </ul>
          </Panel>

          <Panel title="Spectators & display" icon="eye" description="Spectators never see hole cards. The delay makes relaying the stream to a player pointless.">
            <ul className="acr-settings-flags" aria-label="Spectator options">
              {SPECTATOR_INFO.map((s) => (
                <li key={s.key} className={cx('acr-settings-flag', changedKeys.has(`spectators.${s.key}`) && 'is-changed')}>
                  <Toggle
                    id={`settings-spectators-${s.key}`}
                    checked={draft.spectators[s.key]}
                    disabled={disabledFlag || (s.key !== 'enabled' && !draft.spectators.enabled)}
                    onChange={(v) => setSpectator(s.key, v)}
                    label={s.label}
                    description={s.description}
                  />
                  {changedKeys.has(`spectators.${s.key}`) && <Badge tone="info">CHANGED</Badge>}
                </li>
              ))}
            </ul>
            <TextField
              id="settings-spectators-delaySeconds"
              label="Spectator delay"
              suffix="s"
              inputMode="numeric"
              className="acr-settings-delay"
              value={delayText}
              error={delayError}
              hint={`0–${CONFIG_LIMITS.MAX_SPECTATOR_DELAY_SECONDS} seconds; 0 = live`}
              disabled={disabledFlag}
              onChange={(e) => {
                setDelayText(e.target.value);
                const t = e.target.value.trim();
                setSpectator('delaySeconds', /^\d+$/.test(t) ? Number(t) : Number.NaN);
              }}
            />
            {draft.spectators.enabled && !draft.features.spectatorMode && <p className="acr-settings-note">The “Spectator mode” flag is off, so spectator links will not work.</p>}
          </Panel>
        </div>
      </div>

      {!readOnly && (
        <div className="acr-settings-savebar" role="region" aria-label="Save settings">
          <p className="acr-settings-savebar__status" aria-live="polite">
            {issues.size > 0 ? (
              <span className="is-bad">
                <Icon name="warning" /> Fix the highlighted value first
              </span>
            ) : dirty ? (
              <span>
                <Icon name="info" /> {changes.length} unsaved change{changes.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="is-ok">
                <Icon name="check-circle" /> All settings saved
              </span>
            )}
            {serverMoved && dirty && <span className="is-bad"> · changed on the server meanwhile — saving keeps your values</span>}
          </p>
          <Button variant="ghost" icon="x" disabled={!dirty} onClick={discard}>
            Discard
          </Button>
          <Button variant="primary" icon="check" disabled={!dirty || issues.size > 0} onClick={save}>
            {mode === 'running' ? 'Apply changes…' : 'Save settings'}
          </Button>
        </div>
      )}
    </div>
  );
}
