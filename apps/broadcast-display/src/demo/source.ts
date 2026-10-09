import type { DisplayAction } from '../model/types';
import type { DisplayData, DisplaySource } from '../net/source';
import { DEMO_STEP_MS, createDemoEngine } from './demo';
import type { DemoPreset } from './presets';

export { seedFrom } from './prng';

/** Pretend handshake latency, so the connecting state is visible briefly. */
const CONNECT_DELAY_MS = 250;
/** `net=reconnecting`: the demo "drops" the connection this long after opening. */
const DROP_AFTER_MS = 1_500;

export interface DemoSourceOptions {
  preset: DemoPreset;
  seed: number;
  /** Simulate a dropped connection (screenshots of the reconnecting state). */
  dropConnection?: boolean;
  now?: () => number;
}

/** A DisplaySource + DisplayData backed by the deterministic demo engine. */
export function createDemoSource(opts: DemoSourceOptions): { source: DisplaySource; data: DisplayData } {
  const now = opts.now ?? (() => Date.now());
  const engine = createDemoEngine(opts.preset, opts.seed, now());
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let interval: ReturnType<typeof setInterval> | null = null;
  let opened = false;

  const source: DisplaySource = {
    kind: 'demo',
    start(dispatch: (a: DisplayAction) => void) {
      dispatch({ type: 'connection', status: 'connecting' });
      timers.push(
        setTimeout(() => {
          dispatch({ type: 'connection', status: 'open' });
          const frames = engine.open(now());
          // A remount (React StrictMode) re-sends the snapshot only: history is delivered once.
          for (const a of opened ? frames.slice(0, 1) : frames) dispatch(a);
          opened = true;
          interval = setInterval(() => {
            for (const a of engine.step(now())) dispatch(a);
          }, DEMO_STEP_MS);
          if (opts.dropConnection) timers.push(setTimeout(() => dispatch({ type: 'connection', status: 'reconnecting' }), DROP_AFTER_MS));
        }, CONNECT_DELAY_MS),
      );
    },
    nudge() {},
    stop() {
      for (const t of timers) clearTimeout(t);
      timers = [];
      if (interval !== null) clearInterval(interval);
      interval = null;
    },
  };

  const data: DisplayData = {
    leaderboard: (mode, limit) => Promise.resolve(engine.leaderboard(mode, limit)),
    info: () => Promise.resolve(engine.info()),
  };
  return { source, data };
}
