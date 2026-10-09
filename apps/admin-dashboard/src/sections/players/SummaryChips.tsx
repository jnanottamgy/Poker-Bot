import type { Paginated, PlayerListItemDto, TournamentCounters } from '@jpb/shared-types';
import { Icon, cx, formatCount } from '@jpb/ui';
import type { IconName } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { PlayersQuery } from '../../api/types';
import { LIVE_FILTER_META, PLAYER_STATUS_META } from './model';
import type { StatusFilter } from './model';

/** Counts that are not in the tournament counters are read as `total` of a 1-row page. */
const COUNT_POLL_MS = 15_000;

function useStatusTotal(tournamentId: string, status: 'PENDING_APPROVAL' | 'SUSPENDED'): number | null {
  const api = useApi();
  const q: PlayersQuery = { status, offset: 0, limit: 1 };
  const r = useQuery<Paginated<PlayerListItemDto>>(qk.players(tournamentId, q), (s) => api.players.list(tournamentId, q, s), { pollMs: COUNT_POLL_MS });
  return r.data?.total ?? null;
}

interface Chip {
  value: StatusFilter;
  label: string;
  icon: IconName;
  count: number | null;
  tone: string;
  hint: string;
}

export interface SummaryChipsProps {
  tournamentId: string;
  counters: TournamentCounters | null;
  started: boolean;
  maxPlayers: number | null;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
}

/**
 * Status overview + one-click filters. Cheap counts only: tournament
 * counters and two indexed status totals; live connection filters (which
 * the server computes by asking every table) show their count once chosen.
 */
export function SummaryChips({ tournamentId, counters, started, maxPlayers, status, onStatus }: SummaryChipsProps) {
  const pending = useStatusTotal(tournamentId, 'PENDING_APPROVAL');
  const suspended = useStatusTotal(tournamentId, 'SUSPENDED');
  const meta = (s: Exclude<StatusFilter, ''>) => (s in PLAYER_STATUS_META ? PLAYER_STATUS_META[s as keyof typeof PLAYER_STATUS_META] : LIVE_FILTER_META[s as keyof typeof LIVE_FILTER_META]);
  const chip = (value: Exclude<StatusFilter, ''>, count: number | null, label?: string): Chip => {
    const m = meta(value);
    return { value, label: label ?? m.label, icon: m.icon, count, tone: m.tone, hint: m.hint };
  };
  const chips: Chip[] = started
    ? [
        chip('SEATED', null, 'Seated'),
        chip('IN_TRANSIT', counters?.inTransit ?? null),
        chip('DISCONNECTED', null),
        chip('AWAY', null),
        chip('SUSPENDED', suspended),
        chip('PENDING_APPROVAL', pending),
        chip('ELIMINATED', counters?.eliminated ?? null),
      ]
    : [chip('REGISTERED', null, 'Approved'), chip('PENDING_APPROVAL', pending), chip('WITHDRAWN', null, 'Withdrawn / rejected')];
  return (
    <section className="acr-players-sum" aria-label="Players at a glance">
      {started ? (
        <div className="acr-players-sum__total">
          <span className="acr-players-sum__n jpb-num">{counters ? formatCount(counters.active) : '—'}</span>
          <span className="acr-players-sum__l">
            remaining
            <span className="acr-players-sum__of jpb-num"> / {counters ? formatCount(counters.registered) : '—'} registered</span>
          </span>
        </div>
      ) : (
        <div className="acr-players-sum__total">
          <span className="acr-players-sum__n jpb-num">{counters ? formatCount(counters.registered) : '—'}</span>
          <span className="acr-players-sum__l">
            registered
            {maxPlayers !== null && <span className="acr-players-sum__of jpb-num"> / {formatCount(maxPlayers)} max</span>}
          </span>
        </div>
      )}
      <div className="acr-players-sum__chips" role="group" aria-label="Quick status filters">
        <button type="button" className={cx('acr-players-chip', status === '' && 'is-on')} aria-pressed={status === ''} onClick={() => onStatus('')}>
          <Icon name="users" /> All
        </button>
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.hint}
            className={cx('acr-players-chip', `is-${c.tone}`, status === c.value && 'is-on', c.count !== null && c.count > 0 && (c.value === 'PENDING_APPROVAL' || c.value === 'SUSPENDED') && 'has-attention')}
            aria-pressed={status === c.value}
            onClick={() => onStatus(status === c.value ? '' : c.value)}
          >
            <Icon name={c.icon} /> {c.label}
            {c.count !== null && <span className="acr-players-chip__n jpb-num">{formatCount(c.count)}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
