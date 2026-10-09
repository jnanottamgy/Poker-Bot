import { useNavigate } from 'react-router';
import type { TournamentListItemDto } from '@jpb/shared-types';
import { Icon, ProgressBar, TournamentStatusPill, formatCount } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { formatDuration } from '../../lib/time';

/** Cards order: actively dealing first, then breaks, then paused; bigger fields first. */
const LIVE_ORDER = ['RUNNING', 'FINAL_TABLE', 'STARTING', 'BREAK', 'PAUSED'];

/** Cards for tournaments in play right now — the fastest way into a control room. */
export function LiveNow({ rows, now }: { rows: TournamentListItemDto[]; now: number }) {
  const navigate = useNavigate();
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => LIVE_ORDER.indexOf(a.status) - LIVE_ORDER.indexOf(b.status) || b.active - a.active);
  return (
    <section className="acr-livenow" aria-label="Live now">
      {sorted.map((t) => {
        const out = t.registered - t.active;
        return (
          <button key={t.id} type="button" className="acr-livecard" onClick={() => navigate(sectionHref('overview', t.id))}>
            <span className="acr-livecard__head">
              <TournamentStatusPill status={t.status} size="sm" />
              {t.isSimulation && <span className="acr-tag">SIMULATION</span>}
            </span>
            <span className="acr-livecard__name">{t.name}</span>
            <span className="acr-livecard__big jpb-num">
              {formatCount(t.active)}
              <span className="acr-livecard__of"> / {formatCount(t.registered)} players left</span>
            </span>
            <ProgressBar value={out} max={Math.max(1, t.registered - 1)} label="Eliminated" valueText={`${formatCount(out)} of ${formatCount(t.registered)}`} tone="positive" />
            <span className="acr-livecard__meta">
              <span>
                <Icon name="grid" /> {formatCount(t.tables)} {t.tables === 1 ? 'table' : 'tables'}
              </span>
              {t.startedAt && (
                <span>
                  <Icon name="clock" /> {formatDuration(now - t.startedAt)} elapsed
                </span>
              )}
              <span className="acr-livecard__open">
                Open control room <Icon name="arrow-right" />
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
