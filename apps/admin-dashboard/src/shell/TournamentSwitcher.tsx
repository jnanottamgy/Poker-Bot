import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon, TournamentStatusPill, formatCount } from '@jpb/ui';
import { useApi } from '../api/ApiProvider';
import { qk } from '../api/query/keys';
import { useQuery } from '../api/query/useQuery';
import { sectionById, sectionHref } from '../app/sections';
import type { SectionId } from '../app/sections';
import { Popover } from '../components/Popover';

const LIVE_FIRST = ['RUNNING', 'FINAL_TABLE', 'BREAK', 'PAUSED', 'STARTING', 'REGISTRATION', 'REGISTRATION_CLOSED', 'DRAFT', 'COMPLETED', 'CANCELLED'];

/** Top-bar tournament switcher (the page's h1). Keeps the current section when switching. */
export function TournamentSwitcher({ tournamentId, name, section }: { tournamentId: string | null; name: string | null; section: SectionId | null }) {
  const api = useApi();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const list = useQuery(qk.tournaments({ simulations: true }), (s) => api.tournaments.list({ simulations: true }, s), { staleMs: 30_000 });
  const rows = useMemo(() => {
    const all = list.data?.tournaments ?? [];
    const f = filter.trim().toLowerCase();
    return all
      .filter((t) => !f || t.name.toLowerCase().includes(f) || t.joinCode.toLowerCase().includes(f))
      .sort((a, b) => LIVE_FIRST.indexOf(a.status) - LIVE_FIRST.indexOf(b.status) || b.createdAt - a.createdAt);
  }, [list.data, filter]);

  const go = (id: string, close: () => void) => {
    const def = section ? sectionById(section) : null;
    const keep = def && def.scope === 'tournament' && !def.path.includes(':') ? def.id : 'overview';
    close();
    navigate(sectionHref(keep, id));
  };

  return (
    <Popover
      label="Switch tournament"
      className="acr-switcher"
      panelClassName="acr-switcher__panel"
      trigger={(p) => (
        <button type="button" className="acr-switcher__trigger" {...p}>
          <span className="acr-switcher__name">{name ?? 'Select a tournament'}</span>
          <Icon name="chevron-down" />
          <span className="jpb-sr-only">, switch tournament</span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="acr-switcher__search">
            <Icon name="search" />
            <input
              className="acr-switcher__input"
              placeholder="Filter by name or join code"
              aria-label="Filter tournaments"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
          </div>
          <ul className="acr-switcher__list" aria-label="Tournaments">
            {list.isLoading && <li className="acr-switcher__empty">Loading tournaments…</li>}
            {!list.isLoading && rows.length === 0 && <li className="acr-switcher__empty">No tournament matches “{filter}”.</li>}
            {rows.map((t) => (
              <li key={t.id}>
                <button type="button" className="acr-switcher__item" aria-current={t.id === tournamentId ? 'true' : undefined} onClick={() => go(t.id, close)}>
                  <span className="acr-switcher__itemname">
                    {t.name}
                    {t.isSimulation && <span className="acr-switcher__sim">SIM</span>}
                  </span>
                  <span className="acr-switcher__meta">
                    <TournamentStatusPill status={t.status} size="sm" />
                    <span className="jpb-num">
                      {formatCount(t.active || t.registered)} {t.active ? 'left' : 'registered'}
                    </span>
                    <span className="jpb-mono acr-switcher__code">{t.joinCode}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="acr-switcher__all"
            onClick={() => {
              close();
              navigate('/tournaments');
            }}
          >
            <Icon name="layers" /> All tournaments
          </button>
        </>
      )}
    </Popover>
  );
}
