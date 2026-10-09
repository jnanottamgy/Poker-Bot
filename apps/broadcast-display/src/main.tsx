import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@jpb/ui/styles.css';
import './styles/display.css';
import { App } from './App';
import { Waiting } from './components/Overlays';
import { parseParams } from './params';
import type { DisplayData, DisplaySource } from './net/source';

interface Boot {
  source: DisplaySource;
  data: DisplayData | null;
}

async function boot(): Promise<Boot> {
  const params = parseParams(window.location.search, window.location.pathname);
  if (params.demo) {
    // Loaded only in demo mode: the live bundle path never runs the generator.
    const { createDemoSource, seedFrom } = await import('./demo/source');
    return createDemoSource({ preset: params.preset, seed: seedFrom(params.seed), dropConnection: params.dropConnection });
  }
  const { createLiveSource, fetchJoinInfo, fetchLeaderboard, infoFromJoin, resolveTournament } = await import('./net/live');
  const resolved = await resolveTournament({ tournamentId: params.tournamentId, joinCode: params.joinCode });
  const code = resolved.joinCode;
  const known = resolved.info;
  const data: DisplayData = {
    leaderboard: (mode, limit) => (code ? fetchLeaderboard(code, mode, limit) : Promise.reject(new Error('No join code'))),
    // Refreshes prize data when join info is public; otherwise keeps what resolution found (admin overview).
    info: async () => {
      const fresh = code ? await fetchJoinInfo(code).then(infoFromJoin, () => null) : null;
      if (fresh) return fresh;
      if (known) return known;
      throw new Error('No tournament info');
    },
  };
  return { source: createLiveSource({ tournamentId: resolved.tournamentId }), data };
}

const el = document.getElementById('root');
if (el) {
  document.body.classList.add('jpb-app', 'bd-body');
  const root = createRoot(el);
  const pinned = parseParams(window.location.search, window.location.pathname).pinnedScene;
  root.render(<BootScreen title="Connecting to the tournament" detail={null} busy />);
  boot().then(
    ({ source, data }) =>
      root.render(
        <StrictMode>
          <App source={source} data={data} pinnedScene={pinned} />
        </StrictMode>,
      ),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      root.render(<BootScreen title="This screen is not set up yet" detail={`${message} Example: /display/?code=ABC123 or /display/?demo=1`} busy={false} />);
    },
  );
}

function BootScreen(props: { title: string; detail: string | null; busy: boolean }) {
  return (
    <div className="bd-root">
      <div className="bd-frame">
        <Waiting {...props} />
      </div>
    </div>
  );
}
