import type { TournamentStatus } from '@jpb/shared-types';
import type { DisplayState, SceneId } from './types';

/** How long each scene stays up during auto-rotation (ms). */
export const DWELL_MS: Readonly<Record<SceneId, number>> = {
  OVERVIEW: 16_000,
  FEATURED_TABLE: 32_000,
  FINAL_TABLE: 32_000,
  LEADERBOARD: 14_000,
  ANNOUNCEMENT: 15_000,
  CHAMPION: 30_000,
  BREAK: 30_000,
};

/** A new announcement takes the screen for this long, then rotation resumes. */
export const ANNOUNCEMENT_HOLD_MS = 15_000;
/** A scene picked with the S key holds for this long before rotation resumes. */
export const LOCAL_PICK_HOLD_MS = 45_000;

const NOT_STARTED: ReadonlySet<TournamentStatus> = new Set(['DRAFT', 'REGISTRATION', 'REGISTRATION_CLOSED', 'STARTING']);

export interface LocalPick {
  scene: SceneId;
  until: number;
}

export interface SceneContext {
  rotationIndex: number;
  now: number;
  localPick: LocalPick | null;
}

export function hasStarted(s: DisplayState): boolean {
  return !!s.tournament && !NOT_STARTED.has(s.tournament.status);
}

/** The featured table is the final table (the server re-points displays when it forms). */
export function finalTableActive(s: DisplayState): boolean {
  if (!s.featured) return false;
  if (s.tournament?.status === 'FINAL_TABLE') return true;
  return s.finalTableId !== null && s.featured.tableId === s.finalTableId;
}

export function championName(s: DisplayState): string | null {
  if (s.champion) return s.champion.name;
  if (s.tournament?.status !== 'COMPLETED') return null;
  const first = s.finishOrder?.rows.find((r) => r.finishPosition === 1);
  return first?.displayName ?? null;
}

export function isSceneAvailable(s: DisplayState, scene: SceneId): boolean {
  if (!s.tournament) return false;
  switch (scene) {
    case 'OVERVIEW':
      return true;
    case 'FEATURED_TABLE':
      return s.featured !== null;
    case 'FINAL_TABLE':
      return finalTableActive(s);
    case 'LEADERBOARD':
      return hasStarted(s) && ((s.leaderboard?.rows.length ?? 0) > 0 || s.eliminations.length > 0);
    case 'ANNOUNCEMENT':
      return s.announcement !== null;
    case 'CHAMPION':
      return championName(s) !== null;
    case 'BREAK':
      return s.tournament.status === 'BREAK';
  }
}

/** Scenes the idle rotation cycles through, in order. */
export function rotationScenes(s: DisplayState): SceneId[] {
  if (!hasStarted(s)) return ['OVERVIEW'];
  const out: SceneId[] = ['OVERVIEW'];
  if (s.featured) out.push(finalTableActive(s) ? 'FINAL_TABLE' : 'FEATURED_TABLE');
  if (isSceneAvailable(s, 'LEADERBOARD')) out.push('LEADERBOARD');
  return out;
}

/** Every scene that could be shown right now (the S key cycles through these). */
export function availableScenes(s: DisplayState): SceneId[] {
  const order: SceneId[] = ['OVERVIEW', 'FEATURED_TABLE', 'FINAL_TABLE', 'LEADERBOARD', 'ANNOUNCEMENT', 'BREAK', 'CHAMPION'];
  return order.filter((sc) => isSceneAvailable(s, sc) && !(sc === 'FEATURED_TABLE' && finalTableActive(s)));
}

/**
 * Which scene is on screen. Precedence: an S-key pick, a fresh announcement
 * (for ANNOUNCEMENT_HOLD_MS), the admin's choice (held until the admin picks
 * another scene; cleared when the tournament completes), the champion, the
 * break screen, then the idle rotation.
 */
export function resolveScene(s: DisplayState, ctx: SceneContext): SceneId {
  if (ctx.localPick && ctx.now < ctx.localPick.until && isSceneAvailable(s, ctx.localPick.scene)) return ctx.localPick.scene;
  if (s.announcement && ctx.now - s.announcement.at < ANNOUNCEMENT_HOLD_MS) return 'ANNOUNCEMENT';
  const admin = s.adminScene?.scene;
  if (admin && admin !== 'AUTO') {
    // The admin's FEATURED_TABLE choice shows the final-table dressing once the final table plays.
    const wanted = admin === 'FEATURED_TABLE' && finalTableActive(s) ? 'FINAL_TABLE' : admin;
    if (isSceneAvailable(s, wanted)) return wanted;
  }
  if (isSceneAvailable(s, 'CHAMPION')) return 'CHAMPION';
  if (isSceneAvailable(s, 'BREAK')) return 'BREAK';
  const list = rotationScenes(s);
  return list[((ctx.rotationIndex % list.length) + list.length) % list.length] ?? 'OVERVIEW';
}

/** The scene after `current` for the S key. */
export function nextScene(s: DisplayState, current: SceneId): SceneId {
  const list = availableScenes(s);
  if (list.length === 0) return current;
  const i = list.indexOf(current);
  return list[(i + 1) % list.length] ?? current;
}

export const SCENE_LABEL: Readonly<Record<SceneId, string>> = {
  OVERVIEW: 'Overview',
  FEATURED_TABLE: 'Featured table',
  FINAL_TABLE: 'Final table',
  LEADERBOARD: 'Leaderboard',
  ANNOUNCEMENT: 'Announcement',
  CHAMPION: 'Champion',
  BREAK: 'Break',
};
