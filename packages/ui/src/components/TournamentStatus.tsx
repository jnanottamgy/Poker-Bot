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
  BREAK: { label: 'On break', tone: 'warning', icon: 'coffee' },
  PAUSED: { label: 'Paused', tone: 'warning', icon: 'pause' },
  FINAL_TABLE: { label: 'Final table', tone: 'gold', icon: 'crown', live: true },
  COMPLETED: { label: 'Completed', tone: 'gold', icon: 'trophy' },
  CANCELLED: { label: 'Cancelled', tone: 'danger', icon: 'ban' },
};

export function TournamentStatusPill({ status, size = 'md' }: { status: TStatus; size?: 'sm' | 'md' }) {
  const m = TOURNAMENT_STATUS_META[status];
  return <StatusPill tone={m.tone} label={m.label} icon={m.icon} live={m.live} size={size} />;
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
  layout?: 'bar' | 'stacked';
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
  layout = 'bar',
  className,
}: TournamentStatusProps) {
  return (
    <section className={cx('jpb-tstatus', `jpb-tstatus--${layout}`, className)} aria-label="Tournament status">
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
      </dl>
    </section>
  );
}
