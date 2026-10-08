import { Icon, StatusPill, TournamentStatusPill, formatChips, formatClock, formatCount, useServerCountdown } from '@jpb/ui';
import type { TournamentState } from '../live/useTournamentState';
import type { ConnectionInfo } from '../live/hooks';

/** Compact blind clock for the top bar (cosmetic countdown; the server's clock is the authority). */
export function TopClock({ state }: { state: TournamentState }) {
  const { clock, currentLevel } = state;
  const onBreak = clock?.breakEndsAt !== null && clock?.breakEndsAt !== undefined;
  const deadline = onBreak ? (clock?.breakEndsAt ?? null) : (clock?.levelEndsAt ?? null);
  const remaining = useServerCountdown(deadline, state.offsetMs, { intervalMs: 500 });
  if (!clock || !currentLevel) return null;
  const paused = !onBreak && clock.levelEndsAt === null;
  const shown = paused ? (clock.pausedRemainingMs ?? 0) : remaining;
  const lead = onBreak ? 'Break' : paused ? 'Paused' : `L${currentLevel.level}`;
  const label = `${onBreak ? 'On break, ends in' : paused ? 'Clock paused,' : `Level ${currentLevel.level}, blinds ${formatChips(currentLevel.smallBlind)} / ${formatChips(currentLevel.bigBlind)}, next level in`} ${formatClock(shown)}`;
  return (
    <span className={`acr-topclock${onBreak ? ' is-break' : ''}${paused ? ' is-paused' : ''}`} role="timer" aria-label={label} title={label}>
      <Icon name={onBreak ? 'coffee' : paused ? 'pause' : 'clock'} />
      <span className="acr-topclock__lead">{lead}</span>
      {!onBreak && (
        <span className="acr-topclock__blinds jpb-num">
          {formatChips(currentLevel.smallBlind)}/{formatChips(currentLevel.bigBlind)}
        </span>
      )}
      <span className="acr-topclock__time jpb-num">{formatClock(shown)}</span>
    </span>
  );
}

const CONN_COPY: Record<string, { text: string; tone: 'positive' | 'warning' | 'danger' | 'neutral' }> = {
  live: { text: 'Live', tone: 'positive' },
  connecting: { text: 'Connecting', tone: 'warning' },
  reconnecting: { text: 'Reconnecting', tone: 'warning' },
  closed: { text: 'Offline', tone: 'danger' },
  replaced: { text: 'Offline', tone: 'danger' },
  idle: { text: 'Offline', tone: 'neutral' },
  open: { text: 'Syncing', tone: 'warning' },
};

/** Connection health dot + word (never colour alone). */
export function ConnectionDot({ conn }: { conn: ConnectionInfo }) {
  if (conn.status === 'none') return null;
  const c = conn.live ? CONN_COPY.live! : (CONN_COPY[conn.status] ?? CONN_COPY.closed!);
  const detail = conn.live && conn.rttMs !== null ? `Live updates connected · round trip ${Math.round(conn.rttMs)} ms` : `Live updates: ${c.text.toLowerCase()}`;
  return (
    <span className={`acr-conn acr-conn--${c.tone}`} title={detail} role="status" aria-label={detail}>
      <span className="acr-conn__dot" aria-hidden="true" />
      <span className="acr-conn__text" aria-hidden="true">
        {c.text}
      </span>
    </span>
  );
}

export function TopStatus({ state, conn }: { state: TournamentState; conn: ConnectionInfo }) {
  const c = state.counters;
  return (
    <>
      {state.status && <TournamentStatusPill status={state.status} size="sm" />}
      {state.frozen && <StatusPill tone="danger" icon="freeze" label="Frozen" size="sm" />}
      {state.handForHand && <StatusPill tone="warning" icon="pause" label="Hand-for-hand" size="sm" />}
      <TopClock state={state} />
      {c && c.registered > 0 && (
        <span className="acr-topstat" title={`${formatCount(c.active)} players remaining of ${formatCount(c.registered)} registered`}>
          <Icon name="users" />
          <span className="jpb-num">
            {formatCount(c.active || c.registered)}
            <span className="acr-topstat__of"> / {formatCount(c.registered)}</span>
          </span>
          <span className="jpb-sr-only">players remaining of registered</span>
        </span>
      )}
      {c && c.tables > 0 && (
        <span className="acr-topstat" title={`${formatCount(c.tables)} tables in play`}>
          <Icon name="grid" />
          <span className="jpb-num">{formatCount(c.tables)}</span>
          <span className="acr-topstat__of">tables</span>
        </span>
      )}
      <ConnectionDot conn={conn} />
    </>
  );
}
