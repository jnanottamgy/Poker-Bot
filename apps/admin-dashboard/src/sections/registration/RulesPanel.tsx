import type { TournamentConfig } from '@jpb/shared-types';
import { DescriptionList, Icon, Panel, formatCount } from '@jpb/ui';
import { formFields } from './model';

/** The registration rules of the configuration, in plain words (edited in the setup wizard). */
export function RulesPanel({ config }: { config: TournamentConfig }) {
  const fields = formFields(config);
  return (
    <Panel title="Registration rules" icon="file" description="From the tournament configuration.">
      <DescriptionList
        columns={2}
        items={[
          { label: 'Players', value: `${formatCount(Math.max(2, config.minPlayers))} – ${formatCount(config.maxPlayers)}` },
          { label: 'Staff approval', value: config.registration.requireApproval ? 'Required for every registration' : 'Not required' },
          { label: 'Access code', value: config.registration.accessCode ? 'Required' : 'Not required' },
          { label: 'Late registration', value: config.lateRegistration.enabled ? `Through level ${config.lateRegistration.untilLevel}` : 'Off' },
          { label: 'Re-entry', value: config.reentry.enabled ? `${formatCount(config.reentry.maxEntriesPerPlayer)} entries max, through level ${config.reentry.untilLevel}` : 'Off' },
          { label: 'Auto start', value: config.autoStart && config.startTime ? 'At the scheduled time' : 'No — a director starts it' },
        ]}
      />
      <p className="acr-registration-k">Form fields</p>
      <ul className="acr-registration-fields" aria-label="Registration form fields">
        {fields.map((f) => (
          <li key={f.key} className={f.required ? 'is-required' : undefined}>
            <Icon name={f.required ? 'check-circle' : 'dot'} /> {f.label}
            <span className="acr-registration-dim">{f.required ? ' · required' : ' · optional'}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
