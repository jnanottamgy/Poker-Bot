/**
 * Broadcast-display scene switching (admin `POST /api/admin/tournaments/:id/display`).
 *
 * The admin route publishes `{ kind: 'DISPLAY_SCENE', tournamentId, scene, tableId }`
 * on `tournament:{id}:events`. The gateway forwards it to the tournament's
 * DISPLAY sockets only, as an additive server frame that is not (yet) part of
 * the shared `ServerMessage` union:
 *
 *   { t: 'display_scene', st, scene, tableId }
 *
 * Clients that do not know the frame ignore it (the client SDK store's default
 * case). Scene changes carry no game information, so they bypass the spectator
 * delay line.
 */
export interface DisplaySceneBusMessage {
  kind: 'DISPLAY_SCENE';
  tournamentId: string;
  scene: string;
  tableId: string | null;
}

export interface DisplaySceneFrame {
  t: 'display_scene';
  st: number;
  scene: string;
  tableId: string | null;
}

/** Same bound as the admin route's `strParam(body.scene, 40)`. */
const MAX_SCENE_LENGTH = 40;
const MAX_ID_LENGTH = 128;

export function isDisplaySceneMessage(message: unknown): message is DisplaySceneBusMessage {
  if (!message || typeof message !== 'object') return false;
  const m = message as Record<string, unknown>;
  return (
    m.kind === 'DISPLAY_SCENE' &&
    typeof m.tournamentId === 'string' &&
    typeof m.scene === 'string' &&
    m.scene.length > 0 &&
    m.scene.length <= MAX_SCENE_LENGTH &&
    (m.tableId === null || m.tableId === undefined || (typeof m.tableId === 'string' && m.tableId.length <= MAX_ID_LENGTH))
  );
}

export function displaySceneFrame(msg: DisplaySceneBusMessage, st: number): string {
  const f: DisplaySceneFrame = { t: 'display_scene', st, scene: msg.scene, tableId: msg.tableId ?? null };
  return JSON.stringify(f);
}
