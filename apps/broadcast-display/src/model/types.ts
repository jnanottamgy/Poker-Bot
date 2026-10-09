import type { ConnectionStatus } from '@jpb/client-sdk';
import type {
  CardCode,
  JoinInfoDto,
  LeaderboardDto,
  LeaderboardRowDto,
  PrizePlace,
  ServerMessage,
  SpectatorTableView,
  TournamentPublicSummary,
} from '@jpb/shared-types';

/** Every scene the big screen can show. BREAK is automatic (never in the rotation). */
export const SCENES = ['OVERVIEW', 'FEATURED_TABLE', 'LEADERBOARD', 'FINAL_TABLE', 'ANNOUNCEMENT', 'CHAMPION', 'BREAK'] as const;
export type SceneId = (typeof SCENES)[number];

/** Admin scene choice: a fixed scene, or back to auto-rotation. */
export type AdminScene = SceneId | 'AUTO';

/**
 * Additive server frame sent to DISPLAY sockets only when an admin switches
 * the scene (game-server gateway/display.ts). Not part of `ServerMessage` yet.
 */
export interface DisplaySceneFrame {
  t: 'display_scene';
  st: number;
  scene: string;
  tableId: string | null;
}

export type DisplayFrame = ServerMessage | DisplaySceneFrame;

export type Tone = 'neutral' | 'elim' | 'gold' | 'warning' | 'info';

export interface TickerItem {
  id: string;
  at: number;
  tone: Tone;
  text: string;
}

export type SplashKind = 'ELIMINATION' | 'MILESTONE' | 'FINAL_TABLE' | 'TABLE_BROKEN' | 'HAND_FOR_HAND' | 'LEVEL_UP';

export interface Splash {
  id: string;
  /** Client time the event arrived (splashes expire relative to it). */
  at: number;
  kind: SplashKind;
  tone: Tone;
  eyebrow: string;
  title: string;
  subtitle: string | null;
}

export interface EliminationItem {
  id: string;
  playerId: string;
  displayName: string;
  finishPosition: number;
  tiedCount: number;
  playersRemaining: number;
  at: number;
}

export interface ShowdownState {
  handNumber: number;
  /** Final board (HAND_COMPLETED), shown when the view no longer carries the hand. */
  board: CardCode[];
  /** seat -> chips won (summed over pots). */
  winners: Record<number, number>;
  bestFive: CardCode[];
  description: string | null;
  /** seat -> described hand at showdown. */
  reveals: Record<number, string>;
  complete: boolean;
}

export interface TurnState {
  seat: number;
  deadline: number;
  totalMs: number;
}

export interface Announcement {
  id: string;
  text: string;
  from: 'DIRECTOR' | 'ADMIN';
  /** Client receive time. */
  at: number;
}

export interface Champion {
  playerId: string | null;
  name: string;
}

export interface PauseState {
  mode: 'AFTER_HAND' | 'EMERGENCY_FREEZE';
  reason: string | null;
}

/** Public tournament facts that do not ride on the WebSocket (join info / admin overview). */
export interface TournamentInfo {
  name: string;
  joinCode: string | null;
  currency: string;
  places: PrizePlace[];
  startingStack: number | null;
}

export interface LeaderboardState {
  mode: LeaderboardDto['mode'];
  label: string;
  rows: LeaderboardRowDto[];
  total: number;
  fetchedAt: number;
}

export interface DisplayState {
  connection: ConnectionStatus;
  /** An authoritative snapshot arrived on the current connection. */
  synced: boolean;
  error: { code: string; message: string } | null;
  serverOffsetMs: number;
  tournament: TournamentPublicSummary | null;
  featured: SpectatorTableView | null;
  featuredSeq: number;
  showdown: ShowdownState | null;
  turn: TurnState | null;
  lastTournamentSeq: number;
  ticker: TickerItem[];
  eliminations: EliminationItem[];
  splashes: Splash[];
  announcement: Announcement | null;
  champion: Champion | null;
  finalTableId: string | null;
  pause: PauseState | null;
  /** Message of the current break (BREAK_STARTED), if any. */
  breakMessage: string | null;
  adminScene: { scene: AdminScene; tableId: string | null; at: number } | null;
  info: TournamentInfo | null;
  leaderboard: LeaderboardState | null;
  finishOrder: LeaderboardState | null;
}

export type DisplayAction =
  | { type: 'frame'; frame: DisplayFrame; at: number }
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'clock'; offsetMs: number }
  | { type: 'leaderboard'; data: LeaderboardDto; at: number }
  | { type: 'info'; info: TournamentInfo }
  | { type: 'splash_done'; id: string; now: number };

export type { JoinInfoDto };
