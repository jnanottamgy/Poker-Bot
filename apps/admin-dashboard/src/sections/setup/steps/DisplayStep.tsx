import { Badge, Icon, Toggle } from '@jpb/ui';
import { CONFIG_LIMITS } from '@jpb/validation';
import { useWizard } from '../components/context';
import { NumberField } from '../components/fields';
import { Group, Note } from '../components/Group';
import { FEATURE_INFO, SPECTATOR_INFO } from '../model/features';
import { durationLabel, isNum } from '../model/format';

/** Step 8 — spectators (who may watch, delay), feature flags and the players' default sound / haptics. */
export function DisplayStep() {
  const { config, update } = useWizard();
  const s = config.spectators;
  const f = config.features;
  const tournamentFlags = FEATURE_INFO.filter((x) => x.scope === 'tournament');
  const playerFlags = FEATURE_INFO.filter((x) => x.scope === 'player');

  return (
    <>
      <Group title="Spectators" icon="eye" description="Spectators never see hole cards; the delay makes it pointless to relay the stream to a player.">
        <div className="acr-setup-toggles">
          {SPECTATOR_INFO.map((x) => (
            <Toggle
              key={x.key}
              id={`setup-f-spectators-${x.key}`}
              checked={s[x.key]}
              disabled={x.key !== 'enabled' && !s.enabled}
              onChange={(v) => update((c) => ({ ...c, spectators: { ...c.spectators, [x.key]: v } }))}
              label={x.label}
              description={x.description}
            />
          ))}
        </div>
        <div className="acr-setup-grid acr-setup-grid--3">
          <NumberField
            path="spectators.delaySeconds"
            label="Spectator delay"
            required
            suffix="s"
            value={s.delaySeconds}
            onChange={(v) => update((c) => ({ ...c, spectators: { ...c.spectators, delaySeconds: v } }))}
            hint={isNum(s.delaySeconds) && s.delaySeconds > 0 ? `Viewers see play ${durationLabel(s.delaySeconds)} late` : `0–${CONFIG_LIMITS.MAX_SPECTATOR_DELAY_SECONDS} s; 0 = live`}
          />
        </div>
        {s.enabled && !f.spectatorMode && <Note tone="warning">The “Spectator mode” feature flag below is off, so spectator links will not work.</Note>}
      </Group>

      <Group title="Feature flags" icon="sliders" description="Per-tournament switches. Each can also be changed while the tournament runs (Settings screen, audit-logged).">
        <ul className="acr-setup-flags" aria-label="Feature flags">
          {tournamentFlags.map((x) => (
            <li key={x.key} className="acr-setup-flag">
              <Icon name={x.icon} className="acr-setup-flag__icon" />
              <Toggle id={`setup-f-features-${x.key}`} checked={f[x.key]} onChange={(v) => update((c) => ({ ...c, features: { ...c.features, [x.key]: v } }))} label={x.label} description={x.description} />
            </li>
          ))}
        </ul>
        {f.lateRegistration !== config.lateRegistration.enabled && (
          <Note tone="warning">
            {f.lateRegistration ? 'The flag is on but no late-registration window is set (Registration step).' : 'A late-registration window is set but this flag is off, so it will not open.'}
          </Note>
        )}
      </Group>

      <Group
        title="Player defaults"
        icon="phone"
        description="What a player’s phone does out of the box. Each player can still turn these off on their own device."
        actions={<Badge>DEFAULTS</Badge>}
      >
        <ul className="acr-setup-flags" aria-label="Player defaults">
          {playerFlags.map((x) => (
            <li key={x.key} className="acr-setup-flag">
              <Icon name={x.icon} className="acr-setup-flag__icon" />
              <Toggle id={`setup-f-features-${x.key}`} checked={f[x.key]} onChange={(v) => update((c) => ({ ...c, features: { ...c.features, [x.key]: v } }))} label={x.label} description={x.description} />
            </li>
          ))}
        </ul>
      </Group>
    </>
  );
}
