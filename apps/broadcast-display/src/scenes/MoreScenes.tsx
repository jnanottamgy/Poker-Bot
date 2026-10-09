import type { CSSProperties } from 'react';
import { Icon, cx, formatChips, formatClock, formatCount, formatMoneyMinor, formatOrdinal } from '@jpb/ui';
import { blindsText } from '../model/events';
import { formatBB } from '../model/derive';
import type { ClockView, TournamentStats } from '../model/derive';
import { championName } from '../model/scenes';
import type { DisplayState } from '../model/types';

/** Ranking older than this is labelled with its age (the poll failed or the feed is behind). */
const LEADERBOARD_STALE_MS = 60_000;
const ELIMINATIONS_SHOWN = 8;

export function LeaderboardScene({ state, now }: { state: DisplayState; now: number }) {
  const lb = state.leaderboard;
  const rows = lb?.rows ?? [];
  const leader = rows[0]?.stack ?? 0;
  const bb = state.tournament?.currentLevel?.bigBlind ?? 0;
  const paid = state.info?.places.length ?? 0;
  const stale = lb ? now - lb.fetchedAt > LEADERBOARD_STALE_MS : false;
  return (
    <section className="bd-scene bd-leaderboard" aria-label="Leaderboard">
      <div className="bd-lb">
        <div className="bd-lb__head">
          <span className="bd-eyebrow">Chip counts</span>
          <span className="bd-lb__title">{lb?.label ?? 'Current stack ranking'}</span>
          <span className={cx('bd-lb__note', stale && 'is-stale')}>
            {lb ? `Top ${rows.length} of ${formatCount(lb.total)}${stale ? ` · updated ${Math.round((now - lb.fetchedAt) / 60_000)} min ago` : ' · live ranking, not a result'}` : 'Ranking loading'}
          </span>
        </div>
        <ol className="bd-lb__list">
          {rows.map((r, i) => {
            const style = { '--bd-share': `${leader > 0 ? Math.max(4, Math.round((r.stack / leader) * 100)) : 0}%`, '--bd-delay': `${i * 45}ms` } as CSSProperties;
            return (
              <li key={r.playerId} className={cx('bd-lb__row', r.rank === 1 && 'is-leader')} style={style}>
                <span className="bd-lb__rank">{r.rank}</span>
                <span className="bd-lb__name">
                  {r.displayName}
                  {r.tableNumber !== null && <span className="bd-lb__table">Table {r.tableNumber}</span>}
                </span>
                <span className="bd-lb__bar" aria-hidden="true" />
                <span className="bd-lb__stack">{formatChips(r.stack)}</span>
                <span className="bd-lb__bb">{bb > 0 ? formatBB(r.stack / bb) : ''}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <aside className="bd-elims" aria-label="Recent eliminations">
        <span className="bd-eyebrow">Recent eliminations</span>
        {state.eliminations.length === 0 ? (
          <span className="bd-elims__empty">No eliminations yet</span>
        ) : (
          <ol className="bd-elims__list">
            {state.eliminations.slice(0, ELIMINATIONS_SHOWN).map((e) => (
              <li key={e.id} className={cx('bd-elims__row', paid > 0 && e.finishPosition <= paid && 'is-paid')}>
                <span className="bd-elims__pos">{formatOrdinal(e.finishPosition)}</span>
                <span className="bd-elims__name">{e.displayName}</span>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </section>
  );
}

/** Text size steps by length so a short line is huge and a long one still fits. */
function announcementSize(text: string): 'xl' | 'lg' | 'md' {
  if (text.length <= 60) return 'xl';
  if (text.length <= 140) return 'lg';
  return 'md';
}

export function AnnouncementScene({ state }: { state: DisplayState }) {
  const a = state.announcement!;
  return (
    <section className="bd-scene bd-announce" aria-label="Announcement">
      <span className="bd-announce__icon" aria-hidden="true">
        <Icon name="message" />
      </span>
      <span className="bd-eyebrow">{a.from === 'DIRECTOR' ? 'From the tournament director' : 'Announcement'}</span>
      <p className={cx('bd-announce__text', `bd-announce__text--${announcementSize(a.text)}`)}>{a.text}</p>
    </section>
  );
}

export function ChampionScene({ state, stats }: { state: DisplayState; stats: TournamentStats }) {
  const name = championName(state) ?? 'Champion';
  const first = state.info?.places.find((p) => p.position === 1);
  const runners = (state.finishOrder?.rows ?? []).filter((r) => (r.finishPosition ?? 0) > 1).slice(0, 4);
  const currency = state.info?.currency ?? 'INR';
  return (
    <section className="bd-scene bd-champion" aria-label="Champion">
      <div className="bd-champion__glow" aria-hidden="true" />
      <span className="bd-champion__trophy" aria-hidden="true">
        <Icon name="trophy" />
      </span>
      <span className="bd-eyebrow bd-eyebrow--gold">Champion</span>
      <span className="bd-champion__name">{name}</span>
      <span className="bd-champion__sub">
        wins {state.info?.name ?? state.tournament?.name ?? 'the tournament'} · {formatCount(stats.registered)} players
      </span>
      {first && <span className="bd-champion__prize">{formatMoneyMinor(first.amountMinor, currency)}</span>}
      {runners.length > 0 && (
        <ol className="bd-champion__runners">
          {runners.map((r) => (
            <li key={r.playerId}>
              <span className="bd-champion__pos">{formatOrdinal(r.finishPosition ?? r.rank)}</span>
              <span>{r.displayName}</span>
              {r.prizeMinor > 0 && <span className="bd-champion__amt">{formatMoneyMinor(r.prizeMinor, currency)}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function BreakScene({ state, clock, stats }: { state: DisplayState; clock: ClockView; stats: TournamentStats }) {
  const next = state.tournament?.nextLevel ?? null;
  return (
    <section className="bd-scene bd-break" aria-label="Break">
      <span className="bd-break__icon" aria-hidden="true">
        <Icon name="coffee" />
      </span>
      <span className="bd-eyebrow bd-eyebrow--warning">On break</span>
      <span className="bd-break__label">Play resumes in</span>
      <span className="bd-break__time">{clock.mode === 'BREAK' ? formatClock(clock.remainingMs) : '--:--'}</span>
      {state.breakMessage && <span className="bd-break__msg">{state.breakMessage}</span>}
      <div className="bd-break__facts">
        {next && (
          <span>
            Next · Level {next.level} · <strong>{blindsText(next)}</strong>
          </span>
        )}
        <span>
          <strong>{formatCount(stats.remaining)}</strong> players remain
        </span>
        {stats.averageStack !== null && (
          <span>
            Average <strong>{formatChips(stats.averageStack)}</strong>
          </span>
        )}
      </div>
    </section>
  );
}
