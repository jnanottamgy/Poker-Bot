import type { BlindLevel, TournamentConfig, TournamentCounters, TournamentStatus } from '@jpb/shared-types';
import { Icon, ProgressBar, StatusPill, formatChips, formatCount } from '@jpb/ui';
import { formatDateTime } from '../../lib/time';
import { registrationState } from './model';

export interface StatusHeroProps {
  status: TournamentStatus | null;
  config: TournamentConfig;
  counters: TournamentCounters | null;
  level: BlindLevel | null;
  pending: number | null;
  onShowPending: () => void;
}

/** Registration state, counts vs min / max players, pending approvals and the key dates. */
export function StatusHero({ status, config, counters, level, pending, onShowPending }: StatusHeroProps) {
  const st = registrationState(status, config, level);
  const registered = counters?.registered ?? 0;
  const minNeeded = Math.max(2, config.minPlayers);
  const missing = Math.max(0, minNeeded - registered);
  const full = registered >= config.maxPlayers;
  const late = config.lateRegistration;
  const re = config.reentry;
  return (
    <section className="acr-registration-hero" aria-label="Registration status">
      <div className="acr-registration-hero__state">
        <StatusPill tone={st.tone} icon={st.icon} label={st.label} size="md" live={st.key === 'open' || st.key === 'late'} />
        <p className="acr-registration-hero__detail">{st.detail}</p>
      </div>

      <div className="acr-registration-hero__count">
        <p className="acr-registration-hero__big">
          <span className="jpb-num">{formatCount(registered)}</span>
          <span className="acr-registration-hero__of"> / {formatCount(config.maxPlayers)} players</span>
        </p>
        <ProgressBar
          value={registered}
          max={config.maxPlayers}
          label="Registered (approved)"
          valueText={full ? 'Full' : `${formatCount(config.maxPlayers - registered)} seats left`}
          tone={full ? 'warning' : 'positive'}
        />
        <p className={missing > 0 ? 'acr-registration-hero__min is-short' : 'acr-registration-hero__min'}>
          <Icon name={missing > 0 ? 'warning' : 'check-circle'} />
          {missing > 0 ? `${formatCount(missing)} more needed to start (minimum ${formatCount(minNeeded)})` : `Minimum of ${formatCount(minNeeded)} players reached`}
        </p>
      </div>

      <dl className="acr-registration-hero__facts">
        <div>
          <dt>Pending approval</dt>
          <dd>
            {config.registration.requireApproval ? (
              <button type="button" className="acr-registration-hero__pending" onClick={onShowPending} disabled={!pending}>
                <span className="jpb-num">{pending === null ? '—' : formatCount(pending)}</span>
                {pending ? <span> — review</span> : null}
              </button>
            ) : (
              <span className="acr-registration-dim">Not required</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Scheduled start</dt>
          <dd>{config.startTime ? `${formatDateTime(config.startTime)}${config.autoStart ? ' · automatic' : ''}` : 'When you start it'}</dd>
        </div>
        <div>
          <dt>Registration deadline</dt>
          <dd>{config.registrationDeadline ? formatDateTime(config.registrationDeadline) : 'None'}</dd>
        </div>
        <div>
          <dt>Late registration</dt>
          <dd>{late.enabled ? `Until end of level ${late.untilLevel}` : 'Off'}</dd>
        </div>
        <div>
          <dt>Re-entry</dt>
          <dd>{re.enabled ? `Up to ${formatCount(re.maxEntriesPerPlayer)} entries · until level ${re.untilLevel}` : 'Off'}</dd>
        </div>
        <div>
          <dt>Starting stack</dt>
          <dd className="jpb-num">{formatChips(config.startingStack)} chips</dd>
        </div>
      </dl>
    </section>
  );
}
