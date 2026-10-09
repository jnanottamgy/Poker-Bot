import type { PlayerListItemDto, TournamentPlayerStatus } from '@jpb/shared-types';
import { StatusPill } from '@jpb/ui';
import { PLAYER_STATUS_META, connectionOf } from './model';

/** Player status: icon + text + tone, with the meaning in the tooltip. */
export function PlayerStatusPill({ status, size = 'sm', short = false }: { status: TournamentPlayerStatus; size?: 'sm' | 'md'; short?: boolean }) {
  const m = PLAYER_STATUS_META[status];
  const label = short && m.short ? m.short : m.label;
  return <StatusPill size={size} tone={m.tone} icon={m.icon} label={label} title={label === m.label ? m.hint : `${m.label}: ${m.hint}`} />;
}

/** Online / Offline / Away / — (only meaningful at a table). */
export function ConnectionPill({ player, awayAfterTimeouts, size = 'sm' }: { player: Pick<PlayerListItemDto, 'connected' | 'consecutiveTimeouts' | 'status'>; awayAfterTimeouts: number | null; size?: 'sm' | 'md' }) {
  const c = connectionOf(player, awayAfterTimeouts);
  if (c.key === 'none') {
    return (
      <span className="acr-players-none" title={c.hint}>
        —<span className="jpb-sr-only"> not at a table</span>
      </span>
    );
  }
  return <StatusPill size={size} tone={c.tone} icon={c.icon} label={c.label} title={c.hint} />;
}
