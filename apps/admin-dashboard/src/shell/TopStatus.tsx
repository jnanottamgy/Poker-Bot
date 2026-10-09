import { Icon, StatusPill, TournamentStatusPill, formatChips, formatClock, formatCount, useServerCountdown } from '@jpb/ui';
import type { TournamentState } from '../live/useTournamentState';
import type { ConnectionInfo } from '../live/hooks';
import { clockModel, shownRemaining } from '../lib/clock';

/** Compact blind clock for the top bar: level, blinds/ante, countdown (cosmetic; the server's clock is the authority). */
export function TopClock({ state }: { state: TournamentState }) {
  const { clock, currentLevel } = state;
  const model = clockModel({ status: state.status, frozen: state.frozen, clock, hasNextLevel: state.nextLevel !== null });
  const remaining = useServerCountdown(model.deadline, state.offsetMs, { intervalMs: 500 });
  if (!clock || !currentLevel || model.phase === 'not-started' || model.phase === 'ended') return null;
  const shown = shownRemaining(model, remaining);
  const onBreak = model.phase === 'break';
  const held = model.phase === 'paused' || model.phase === 'frozen';
  const blinds = `${formatChips(currentLevel.smallBlind)}/${formatChips(currentLevel.bigBlind)}${currentLevel.ante ? ` (${formatChips(currentLevel.ante)})` : ''}`;
  const time = model.phase === 'last-level' ? 'no end' : held && model.heldRemainingMs === null ? '—' : formatClock(shown);
  const lead = onBreak ? 'Break' : `L${currentLevel.level}`;
  const label = onBreak
    ? `On break, ends in ${formatClock(shown)}`
    : `Level ${currentLevel.level}, blinds ${formatChips(currentLevel.smallBlind)} / ${formatChips(currentLevel.bigBlind)}${currentLevel.ante ? `, ante ${formatChips(currentLevel.ante)}` : ''}, ${
        model.phase === 'last-level' ? 'last level, no end' : held ? `clock ${model.label.toLowerCase()} with ${time} left` : `next level in ${time}`
      }`;
  return (
    <span className={`acr-topclock${onBreak ? ' is-break' : ''}${held ? ' is-paused' : ''}`} role="timer" aria-label={label} title={label}>
      <Icon name={onBreak ? 'coffee' : model.phase === 'frozen' ? 'freeze' : held ? 'pause' : 'clock'} />
      <span className="acr-topclock__lead">{lead}</span>
      {!onBreak && <span className="acr-topclock__blinds jpb-num">{blinds}</span>}
      <span className="acr-topclock__time jpb-num">{time}</span>
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

/** Top-bar live status. `stale`: not live — the figures are greyed (never shown as live while stale). */
export function TopStatus({ state, conn, stale = false }: { state: TournamentState; conn: ConnectionInfo; stale?: boolean }) {
  const c = state.counters;
  return (
    <>
      <span className={stale ? 'acr-topstatus jpb-stale' : 'acr-topstatus'} data-stale={stale ? 'true' : undefined}>
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
      </span>
      <ConnectionDot conn={conn} />
    </>
  );
}
