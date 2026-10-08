import type { TournamentStatus as TStatus } from '@jpb/shared-types';
import { cx } from '../cx';
import { formatChips, formatCount } from '../format';
import type { IconName } from './Icon';
import { StatusPill } from './StatusPill';
import type { Tone } from './StatusPill';

export const TOURNAMENT_STATUS_META: Readonly<Record<TStatus, { label: string; tone: Tone; icon: IconName; live?: boolean }>> = {
  DRAFT: { label: 'Draft', tone: 'neutral', icon: 'file' },
  REGISTRATION: { label: 'Registration open', tone: 'info', icon: 'users' },
  REGISTRATION_CLOSED: { label: 'Registration closed', tone: 'neutral', icon: 'lock' },
  STARTING: { label: 'Starting', tone: 'info', icon: 'clock' },
  RUNNING: { label: 'Running', tone: 'positive', icon: 'play', live: true },
  BREAK: { label: 'On break', tone: 'info', icon: 'coffee' },
  PAUSED: { label: 'Paused', tone: 'warning', icon: 'pause' },
  FINAL_TABLE: { label: 'Final table', tone: 'gold', icon: 'crown', live: true },
  COMPLETED: { label: 'Completed', tone: 'gold', icon: 'trophy' },
  CANCELLED: { label: 'Cancelled', tone: 'danger', icon: 'ban' },
};

/**
 * `quiet` (player app): a normal RUNNING state is a neutral pill where only the
 * live dot is green; exceptions (break, paused, final table...) keep their tone.
 */
export function TournamentStatusPill({ status, size = 'md', quiet = false }: { status: TStatus; size?: 'sm' | 'md'; quiet?: boolean }) {
  const m = TOURNAMENT_STATUS_META[status];
  const tone = quiet && m.tone === 'positive' ? 'neutral' : m.tone;
  return <StatusPill tone={tone} label={m.label} icon={m.icon} live={m.live} size={size} className={quiet && m.live ? 'jpb-pill--quiet-live' : undefined} />;
}

export interface TournamentStatusProps {
  name?: string;
  status: TStatus;
  playersRemaining: number;
  playersTotal: number;
  tables: number;
  level: number;
  averageStack?: number;
  handForHand?: boolean;
  /** Pre-formatted prize pool (headline stat). */
  prizePool?: string;
  layout?: 'bar' | 'stacked';
  /** Projector scale: numbers readable from the back of the room. */
  size?: 'md' | 'broadcast';
  className?: string;
}

/** Status pill + players remaining + tables + level (+ hand-for-hand flag). */
export function TournamentStatus({
  name,
  status,
  playersRemaining,
  playersTotal,
  tables,
  level,
  averageStack,
  handForHand = false,
  prizePool,
  layout = 'bar',
  size = 'md',
  className,
}: TournamentStatusProps) {
  return (
    <section className={cx('jpb-tstatus', `jpb-tstatus--${layout}`, `jpb-tstatus--${size}`, className)} aria-label="Tournament status">
      {name && <h2 className="jpb-tstatus__name">{name}</h2>}
      <div className="jpb-tstatus__pills">
        <TournamentStatusPill status={status} />
        {handForHand && <StatusPill tone="warning" icon="pause" label="Hand-for-hand" />}
      </div>
      <dl className="jpb-tstatus__stats">
        <div>
          <dt>Players</dt>
          <dd className="jpb-num">
            {formatCount(playersRemaining)}
            <span className="jpb-tstatus__of"> / {formatCount(playersTotal)}</span>
          </dd>
        </div>
        <div>
          <dt>Tables</dt>
          <dd className="jpb-num">{formatCount(tables)}</dd>
        </div>
        <div>
          <dt>Level</dt>
          <dd className="jpb-num">{level}</dd>
        </div>
        {averageStack !== undefined && (
          <div>
            <dt>Avg stack</dt>
            <dd className="jpb-num">{formatChips(averageStack)}</dd>
          </div>
        )}
        {prizePool !== undefined && (
          <div className="jpb-tstatus__prize">
            <dt>Prize pool</dt>
            <dd className="jpb-num">{prizePool}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
