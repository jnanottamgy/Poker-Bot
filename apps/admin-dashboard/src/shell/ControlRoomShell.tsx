import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useMatches, useNavigate } from 'react-router';
import { AdminShell } from '@jpb/ui';
import type { NavItem } from '@jpb/ui';
import { SECTIONS, sectionById, sectionHref } from '../app/sections';
import type { SectionId } from '../app/sections';
import { useSession } from '../auth/SessionProvider';
import { inTournamentScope } from '../auth/scope';
import { useTournamentControls } from '../danger/useTournamentControls';
import { useConnection } from '../live/hooks';
import { useTournamentState } from '../live/useTournamentState';
import { GlobalSearch } from './GlobalSearch';
import { ShellBanners, useSustained } from './ShellBanners';
import { ShortcutSheet } from './ShortcutSheet';
import { TopActions } from './TopActions';
import { TopStatus } from './TopStatus';
import { TournamentSwitcher } from './TournamentSwitcher';
import { useHotkeys } from './useHotkeys';

/** Grace before "reconnecting" greys the screen (first connect, short blips). */
const STALE_GRACE_MS = 1500;

function useActiveSection(): SectionId | null {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]?.handle as { section?: SectionId } | undefined;
    if (handle?.section) return handle.section;
  }
  return null;
}

/**
 * The control-room frame around every screen: AdminShell from @jpb/ui with
 * the full §1 navigation, the live top bar, global banners, search and
 * keyboard shortcuts. Sections never render chrome themselves.
 */
export function ControlRoomShell({ tournamentId, children }: { tournamentId: string | null; children: ReactNode }) {
  const navigate = useNavigate();
  const { me } = useSession();
  const section = useActiveSection();
  const state = useTournamentState(tournamentId);
  const conn = useConnection();
  const controls = useTournamentControls(tournamentId, state);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const lastLiveAt = useRef<number | null>(null);
  if (conn.live) lastLiveAt.current = Date.now();

  const notLive = tournamentId !== null && (!conn.live || state.overview.isStale);
  const stale = useSustained(notLive, STALE_GRACE_MS);

  const openAlerts = state.overview.data?.openAlerts ?? 0;
  const activeNav = section ? (sectionById(section).navParent ?? section) : null;
  const nav: NavItem[] = useMemo(
    () =>
      SECTIONS.filter((s) => s.group && (!s.permission || (me?.permissions.includes(s.permission) ?? false))).map((s) => ({
        id: s.id,
        label: s.label,
        icon: s.icon,
        group: s.group,
        disabled: s.scope === 'tournament' && (!tournamentId || !inTournamentScope(me, tournamentId)),
        ...(s.id === 'alerts' && openAlerts > 0 ? { badge: openAlerts, badgeTone: 'danger' as const } : {}),
      })),
    [me, tournamentId, openAlerts],
  );

  useHotkeys({
    onSearch: () => setSearchOpen(true),
    onHelp: () => setHelpOpen(true),
    onGo: (key) => {
      const target = SECTIONS.find((s) => s.goKey === key);
      if (!target || (target.scope === 'tournament' && !tournamentId)) return false;
      navigate(sectionHref(target.id, tournamentId));
      return true;
    },
  });

  useEffect(() => {
    const label = section ? sectionById(section).label : 'Control Room';
    const name = state.overview.data?.name;
    document.title = `${label}${name ? ` · ${name}` : ''} — Control Room`;
  }, [section, state.overview.data?.name]);

  const sectionLabel = section ? sectionById(section).label : null;
  const o = state.overview.data;
  return (
    <>
      <AdminShell
        brand="Johnny's Poker Bot"
        nav={nav}
        activeId={activeNav ?? ''}
        onNavigate={(id) => navigate(sectionHref(id as SectionId, tournamentId))}
        title={<TournamentSwitcher tournamentId={tournamentId} name={o?.name ?? null} section={section} />}
        subtitle={
          <>
            {sectionLabel ?? 'Control Room'}
            {o && (
              <>
                {' · '}
                <span className="jpb-mono">{o.joinCode}</span>
                {o.isSimulation && ' · simulation'}
              </>
            )}
          </>
        }
        status={tournamentId ? <TopStatus state={state} conn={conn} /> : undefined}
        actions={<TopActions tournamentId={tournamentId} state={state} controls={controls} openAlerts={openAlerts} onSearch={() => setSearchOpen(true)} onShortcuts={() => setHelpOpen(true)} />}
        user={me ? { name: me.admin.displayName, role: me.admin.role } : undefined}
        banner={<ShellBanners tournamentId={tournamentId} frozen={state.frozen} stale={stale} conn={conn} lastLiveAt={lastLiveAt.current} controls={controls} />}
      >
        <div className={stale ? 'acr-content jpb-stale' : 'acr-content'} data-stale={stale ? 'true' : undefined} aria-busy={stale || undefined}>
          {children}
        </div>
      </AdminShell>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} tournamentId={tournamentId} />
      <ShortcutSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
