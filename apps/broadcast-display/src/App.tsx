import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PauseOverlay, SplashCard, Waiting } from './components/Overlays';
import { TopBar, Ticker } from './components/Chrome';
import { clockView, tournamentStats } from './model/derive';
import { SPLASH_MAX_AGE_MS } from './model/reducer';
import { DWELL_MS, LOCAL_PICK_HOLD_MS, nextScene, resolveScene, rotationScenes } from './model/scenes';
import type { LocalPick } from './model/scenes';
import type { DisplayState, SceneId } from './model/types';
import type { DisplayData, DisplaySource } from './net/source';
import { useDisplay, useNow, useRotation } from './hooks/useDisplay';
import { OverviewScene } from './scenes/OverviewScene';
import { TableScene } from './scenes/TableScene';
import { AnnouncementScene, BreakScene, ChampionScene, LeaderboardScene } from './scenes/MoreScenes';

/** How long one milestone splash stays up. */
export const SPLASH_SHOW_MS = 5_500;
/** Countdown repaint period (visual only; the server owns the clock). */
const TICK_MS = 250;

export interface AppProps {
  source: DisplaySource;
  data: DisplayData | null;
  pinnedScene: SceneId | null;
}

export function App({ source, data, pinnedScene }: AppProps) {
  const [state, dispatch] = useDisplay(source, data);
  const now = useNow(TICK_MS);
  const serverNow = now + state.serverOffsetMs;
  const live = state.connection === 'open' && state.synced;

  const rotationList = rotationScenes(state);
  const rotation = useRotation((i) => DWELL_MS[rotationList[i % rotationList.length] ?? 'OVERVIEW'], now);

  const [keyPick, setKeyPick] = useState<LocalPick | null>(null);
  const localPick: LocalPick | null = keyPick && now < keyPick.until ? keyPick : pinnedScene ? { scene: pinnedScene, until: Number.POSITIVE_INFINITY } : null;
  const scene = resolveScene(state, { rotationIndex: rotation.index, now, localPick });

  const latest = useRef<{ state: DisplayState; scene: SceneId }>({ state, scene });
  latest.current = { state, scene };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === 'f') toggleFullscreen();
      if (key === 's') {
        const { state: s, scene: current } = latest.current;
        setKeyPick({ scene: nextScene(s, current), until: Date.now() + LOCAL_PICK_HOLD_MS });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const splash = state.splashes[0] ?? null;
  useEffect(() => {
    if (!splash) return undefined;
    const expired = Date.now() - splash.at > SPLASH_MAX_AGE_MS;
    const id = setTimeout(() => dispatch({ type: 'splash_done', id: splash.id, now: Date.now() }), expired ? 0 : SPLASH_SHOW_MS);
    return () => clearTimeout(id);
  }, [splash, dispatch]);

  const name = state.tournament?.name ?? state.info?.name ?? "Johnny's Poker Bot";
  useEffect(() => {
    document.title = `${name} — Live`;
  }, [name]);

  const clock = useMemo(() => clockView(state.tournament, serverNow), [state.tournament, serverNow]);
  const stats = tournamentStats(state);

  if (!state.tournament) {
    const err = state.error;
    return (
      <Frame>
        <Waiting title={err ? refusalTitle(err.code) : 'Connecting to the tournament'} detail={err ? err.message : 'The big screen comes alive as soon as the server answers.'} busy={!err} />
      </Frame>
    );
  }

  const showSplash = splash && now - splash.at <= SPLASH_MAX_AGE_MS && scene !== 'CHAMPION';
  const showPause = state.pause && scene !== 'CHAMPION';
  return (
    <Frame scene={scene}>
      <TopBar state={state} live={live} clock={clock} name={name} showMiniClock={scene !== 'OVERVIEW' && scene !== 'BREAK' && scene !== 'CHAMPION'} />
      <main className="bd-stage" data-stale={!live || undefined} aria-live="off">
        <div key={scene} className="bd-stage__scene">
          {renderScene(scene, state, { now, serverNow, clock, stats })}
        </div>
        {showPause && <PauseOverlay pause={state.pause!} clock={clock} level={state.tournament.currentLevel?.level ?? null} />}
        {showSplash && <SplashCard splash={splash} />}
      </main>
      <Ticker items={state.ticker} />
    </Frame>
  );
}

function renderScene(
  scene: SceneId,
  state: DisplayState,
  ctx: { now: number; serverNow: number; clock: ReturnType<typeof clockView>; stats: ReturnType<typeof tournamentStats> },
) {
  switch (scene) {
    case 'FEATURED_TABLE':
    case 'FINAL_TABLE':
      return <TableScene state={state} serverNow={ctx.serverNow} final={scene === 'FINAL_TABLE'} />;
    case 'LEADERBOARD':
      return <LeaderboardScene state={state} now={ctx.now} />;
    case 'ANNOUNCEMENT':
      return <AnnouncementScene state={state} />;
    case 'CHAMPION':
      return <ChampionScene state={state} stats={ctx.stats} />;
    case 'BREAK':
      return <BreakScene state={state} clock={ctx.clock} stats={ctx.stats} />;
    case 'OVERVIEW':
    default:
      return <OverviewScene state={state} clock={ctx.clock} stats={ctx.stats} />;
  }
}

/** The 16:9 broadcast frame, letterboxed and scaled to any screen. */
function Frame({ scene, children }: { scene?: SceneId; children: ReactNode }) {
  return (
    <div className="bd-root">
      <div className="bd-frame" data-scene={scene}>
        {children}
      </div>
    </div>
  );
}

function refusalTitle(code: string): string {
  switch (code) {
    case 'DISPLAY_NOT_ALLOWED':
      return 'The big screen is not enabled';
    case 'TOURNAMENT_NOT_FOUND':
      return 'Tournament not found';
    case 'NO_TOURNAMENT':
      return 'Which tournament?';
    default:
      return 'Waiting for the server';
  }
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}
