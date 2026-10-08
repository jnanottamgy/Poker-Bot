import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Icon, Modal, Spinner, formatChips } from '@jpb/ui';
import type { IconName } from '@jpb/ui';
import { useApi } from '../api/ApiProvider';
import type { AdminApi } from '../api/client';
import { friendlyError } from '../api/errors';
import { sectionHref } from '../app/sections';

export interface SearchResult {
  id: string;
  group: 'Players' | 'Tables' | 'Hands' | 'Tournaments';
  icon: IconName;
  title: string;
  meta: string;
  href: string;
}

const DEBOUNCE_MS = 200;
const PER_GROUP = 6;

/** Interprets the query: "T12" / "table 12" → table, "#1234" / "hand 1234" → hand, digits → both, else players. */
export function parseSearch(raw: string): { text: string; table: number | null; hand: number | null } {
  const q = raw.trim();
  const table = /^(?:t|table\s*)(\d{1,6})$/i.exec(q);
  if (table) return { text: '', table: Number(table[1]), hand: null };
  const hand = /^(?:#|hand\s*#?)(\d{1,9})$/i.exec(q);
  if (hand) return { text: '', table: null, hand: Number(hand[1]) };
  if (/^\d{1,9}$/.test(q)) return { text: '', table: Number(q), hand: Number(q) };
  return { text: q, table: null, hand: null };
}

export async function runSearch(api: AdminApi, tournamentId: string | null, raw: string, signal: AbortSignal): Promise<SearchResult[]> {
  const { text, table, hand } = parseSearch(raw);
  const out: SearchResult[] = [];
  if (!tournamentId) {
    const list = await api.tournaments.list({ simulations: true }, signal);
    const f = raw.trim().toLowerCase();
    for (const t of list.tournaments.filter((x) => x.name.toLowerCase().includes(f) || x.joinCode.toLowerCase().includes(f)).slice(0, PER_GROUP)) {
      out.push({ id: `t-${t.id}`, group: 'Tournaments', icon: 'layers', title: t.name, meta: `${t.joinCode} · ${t.status.replace(/_/g, ' ').toLowerCase()}`, href: sectionHref('overview', t.id) });
    }
    return out;
  }
  const jobs: Array<Promise<void>> = [];
  if (text) {
    jobs.push(
      api.players.list(tournamentId, { q: text, limit: PER_GROUP, sort: 'stack' }, signal).then((r) => {
        for (const p of r.rows) {
          const where = p.tableNumber !== null ? `Table ${p.tableNumber}, seat ${(p.seat ?? 0) + 1}` : p.status.replace(/_/g, ' ').toLowerCase();
          out.push({ id: `p-${p.playerId}`, group: 'Players', icon: 'user', title: p.displayName + (p.nickname ? ` “${p.nickname}”` : ''), meta: `${p.publicId} · ${where} · ${formatChips(p.stack)} chips`, href: sectionHref('player-detail', tournamentId, { playerId: p.playerId }) });
        }
      }),
    );
  }
  if (table !== null) {
    jobs.push(
      api.tables.list(tournamentId, { q: String(table), limit: PER_GROUP }, signal).then((r) => {
        for (const t of r.rows) {
          out.push({ id: `tb-${t.tableId}`, group: 'Tables', icon: 'grid', title: `Table ${t.tableNumber}`, meta: `${t.players}/${t.maxSeats} players · hand #${t.handNumber} · ${t.status.replace(/_/g, ' ').toLowerCase()}`, href: sectionHref('table-detail', tournamentId, { tableId: t.tableId }) });
        }
      }),
    );
  }
  if (hand !== null) {
    jobs.push(
      api.hands.list(tournamentId, { handNumber: hand, limit: PER_GROUP }, signal).then((r) => {
        for (const h of r.rows) {
          out.push({ id: `h-${h.handId}`, group: 'Hands', icon: 'list', title: `Hand #${h.handNumber} · Table ${h.tableNumber}`, meta: `Pot ${formatChips(h.totalPot)} · ${h.showdown ? 'showdown' : 'no showdown'}`, href: sectionHref('hand-detail', tournamentId, { handId: h.handId }) });
        }
      }),
    );
  }
  await Promise.all(jobs);
  const order = ['Players', 'Tables', 'Hands'];
  return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

/** `/` — global search across players, public ids, tables and hands of the current tournament. */
export function GlobalSearch({ open, onClose, tournamentId }: { open: boolean; onClose: () => void; tournamentId: string | null }) {
  const api = useApi();
  const navigate = useNavigate();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setResults([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !q.trim()) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      runSearch(api, tournamentId, q, ctrl.signal)
        .then((r) => {
          setResults(r);
          setActive(0);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!ctrl.signal.aborted) setError(friendlyError(err).description);
        })
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [api, open, q, tournamentId]);

  const choose = (r: SearchResult | undefined) => {
    if (!r) return;
    onClose();
    navigate(r.href);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    }
  };

  let lastGroup = '';
  return (
    <Modal open={open} onClose={onClose} title="Search" size="md" initialFocusRef={inputRef} className="acr-search">
      <div className="acr-search__field">
        <Icon name="search" />
        <input
          ref={inputRef}
          className="acr-search__input"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={results[active] ? `${id}-${results[active].id}` : undefined}
          aria-label={tournamentId ? 'Search players, public ids, tables and hands' : 'Search tournaments'}
          placeholder={tournamentId ? 'Name, JPN-7A42, T12, #1234…' : 'Tournament name or join code…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          autoComplete="off"
          spellCheck={false}
        />
        {loading && <Spinner size="sm" />}
      </div>
      <p className="jpb-sr-only" role="status">
        {q.trim() && !loading ? `${results.length} results` : ''}
      </p>
      {error && (
        <p className="acr-search__error" role="alert">
          <Icon name="warning" /> {error}
        </p>
      )}
      <ul id={`${id}-list`} role="listbox" className="acr-search__list" aria-label="Results">
        {results.map((r, i) => {
          const header = r.group !== lastGroup;
          lastGroup = r.group;
          return (
            <li key={r.id} role="presentation">
              {header && (
                <p className="acr-search__group" aria-hidden="true">
                  {r.group}
                </p>
              )}
              <div
                id={`${id}-${r.id}`}
                role="option"
                aria-selected={i === active}
                className="acr-search__item"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(r);
                }}
              >
                <Icon name={r.icon} />
                <span className="acr-search__text">
                  <span className="acr-search__title">{r.title}</span>
                  <span className="acr-search__meta">{r.meta}</span>
                </span>
                <span className="acr-search__group-label">{r.group.slice(0, -1)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {q.trim() && !loading && !error && results.length === 0 && <p className="acr-search__empty">Nothing found for “{q.trim()}”. Try a name, a public id like JPN-7A42, T12 or #1234.</p>}
      {!q.trim() && (
        <p className="acr-search__hint">
          Try <kbd className="jpb-kbd">Meera</kbd> <kbd className="jpb-kbd">JPN-7A42</kbd> <kbd className="jpb-kbd">T37</kbd> <kbd className="jpb-kbd">#1290</kbd> — ↑ ↓ to move, Enter to open.
        </p>
      )}
    </Modal>
  );
}
