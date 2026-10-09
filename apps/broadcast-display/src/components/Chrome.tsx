import type { CSSProperties } from 'react';
import { Icon, cx, formatClock } from '@jpb/ui';
import { blindsText } from '../model/events';
import type { ClockView } from '../model/derive';
import type { DisplayState, TickerItem } from '../model/types';

const STATUS_PILL: Partial<Record<string, { label: string; tone: string }>> = {
  REGISTRATION: { label: 'Registration open', tone: 'info' },
  REGISTRATION_CLOSED: { label: 'Registration closed', tone: 'info' },
  STARTING: { label: 'Starting', tone: 'info' },
  BREAK: { label: 'On break', tone: 'warning' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  FINAL_TABLE: { label: 'Final table', tone: 'gold' },
  COMPLETED: { label: 'Complete', tone: 'gold' },
  CANCELLED: { label: 'Cancelled', tone: 'warning' },
};

export interface TopBarProps {
  state: DisplayState;
  live: boolean;
  clock: ClockView;
  showMiniClock: boolean;
  name: string;
}

/** Brand, tournament name, status, a mini blind clock (when the scene has none) and the LIVE / reconnecting marker. */
export function TopBar({ state, live, clock, showMiniClock, name }: TopBarProps) {
  const t = state.tournament;
  const pill = t ? STATUS_PILL[t.status] : undefined;
  const frozen = state.pause?.mode === 'EMERGENCY_FREEZE';
  return (
    <header className="bd-top">
      <div className="bd-top__brand">
        <span className="bd-logo" aria-hidden="true">
          ♠
        </span>
        <div className="bd-top__titles">
          <span className="bd-top__eyebrow">Johnny&apos;s Poker Bot</span>
          <span className="bd-top__name">{name}</span>
        </div>
      </div>
      <div className="bd-top__right">
        {pill && <span className={cx('bd-pill', `bd-pill--${frozen ? 'info' : pill.tone}`)}>{frozen ? 'Play frozen' : pill.label}</span>}
        {t?.handForHand && <span className="bd-pill bd-pill--warning">Hand-for-hand</span>}
        {showMiniClock && t?.currentLevel && (
          <span className="bd-miniclock">
            <span className="bd-miniclock__lvl">Lvl {t.currentLevel.level}</span>
            <span className="bd-miniclock__blinds">{blindsText(t.currentLevel)}</span>
            {clock.mode !== 'IDLE' && <span className={cx('bd-miniclock__time', clock.mode !== 'LEVEL' && 'is-held')}>{formatClock(clock.remainingMs)}</span>}
          </span>
        )}
        <LiveMarker live={live} connection={state.connection} hasData={!!t} />
      </div>
    </header>
  );
}

function LiveMarker({ live, connection, hasData }: { live: boolean; connection: DisplayState['connection']; hasData: boolean }) {
  if (live) {
    return (
      <span className="bd-live" aria-label="Live">
        <span className="bd-live__dot" aria-hidden="true" />
        Live
      </span>
    );
  }
  // Discreet: a small chip, the stage itself is greyed out as stale.
  const text = connection === 'connecting' && !hasData ? 'Connecting' : connection === 'closed' ? 'Offline' : 'Reconnecting';
  return (
    <span className="bd-reconnect" role="status">
      <Icon name={connection === 'closed' ? 'wifi-off' : 'refresh'} className={cx(connection !== 'closed' && 'bd-spin')} />
      {text}
    </span>
  );
}

/** Bottom ticker of recent events, newest first; a static list when motion is reduced. */
export function Ticker({ items }: { items: TickerItem[] }) {
  const newest = [...items].reverse();
  if (newest.length === 0) {
    return (
      <footer className="bd-ticker">
        <span className="bd-ticker__label">Latest</span>
        <div className="bd-ticker__viewport">
          <span className="bd-ticker__item bd-ticker__item--neutral">Follow the action live on the big screen</span>
        </div>
      </footer>
    );
  }
  const chars = newest.reduce((n, i) => n + i.text.length + 6, 0);
  const style = { '--bd-ticker-duration': `${Math.max(24, Math.round(chars * 0.22))}s` } as CSSProperties;
  const row = (hidden: boolean) =>
    newest.map((i) => (
      <span key={`${hidden ? 'b' : 'a'}${i.id}`} className={cx('bd-ticker__item', `bd-ticker__item--${i.tone}`)} aria-hidden={hidden || undefined}>
        {i.text}
      </span>
    ));
  return (
    <footer className="bd-ticker">
      <span className="bd-ticker__label">Latest</span>
      <div className="bd-ticker__viewport" aria-live="polite">
        <div className="bd-ticker__track" style={style}>
          <div className="bd-ticker__run">{row(false)}</div>
          <div className="bd-ticker__run bd-ticker__run--copy">{row(true)}</div>
        </div>
      </div>
    </footer>
  );
}
