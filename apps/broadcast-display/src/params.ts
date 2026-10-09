import { DEMO_PRESETS } from './demo/presets';
import type { DemoPreset } from './demo/presets';
import { SCENES } from './model/types';
import type { SceneId } from './model/types';

/**
 * Page parameters:
 *   /display/?t=<tournamentId>            live, by tournament id
 *   /display/?code=<joinCode>             live, by join code (also /display/<joinCode>)
 *   &scene=LEADERBOARD                    pin one scene (a dedicated screen)
 *   ?demo=1[&preset=final][&seed=7]       deterministic demo, no server
 *   &net=reconnecting                     demo: show the reconnecting state
 */
export interface DisplayParams {
  tournamentId: string | null;
  joinCode: string | null;
  demo: boolean;
  preset: DemoPreset;
  seed: string;
  pinnedScene: SceneId | null;
  dropConnection: boolean;
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const JOIN_CODE = /^[A-Za-z0-9]{4,12}$/;
const BASE = '/display/';

export function parseParams(search: string, pathname: string): DisplayParams {
  const q = new URLSearchParams(search);
  const t = q.get('t') ?? q.get('tournamentId');
  const code = q.get('code') ?? codeFromPath(pathname);
  const preset = (q.get('preset') ?? 'running').toLowerCase();
  const scene = (q.get('scene') ?? '').toUpperCase();
  return {
    tournamentId: t && ID.test(t) ? t : null,
    joinCode: code && JOIN_CODE.test(code) ? code.toUpperCase() : null,
    demo: q.get('demo') === '1' || q.get('demo') === 'true',
    preset: (DEMO_PRESETS as readonly string[]).includes(preset) ? (preset as DemoPreset) : 'running',
    seed: q.get('seed') ?? 'johnny',
    pinnedScene: (SCENES as readonly string[]).includes(scene) ? (scene as SceneId) : null,
    dropConnection: q.get('net') === 'reconnecting',
  };
}

/** `/display/ABC123` (the admin demo panel's link form). */
function codeFromPath(pathname: string): string | null {
  const i = pathname.indexOf(BASE);
  if (i < 0) return null;
  const rest = pathname.slice(i + BASE.length).split('/')[0] ?? '';
  return rest && rest !== 'index.html' ? decodeURIComponent(rest) : null;
}
