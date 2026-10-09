/**
 * Contract between the desktop app's main process (which runs PostgreSQL and
 * the game server) and its launcher window (renderer). The preload script
 * exposes exactly `DesktopApi` as `window.jpbDesktop`; every method is an
 * IPC call on one of the CHANNELS below. Plain data only (structured clone).
 */

/** Lifecycle of the bundled server (PostgreSQL + game server) as one unit. */
export type ServerPhase = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export type StartupStepId = 'database' | 'migrations' | 'server' | 'signin';

export interface StartupStep {
  id: StartupStepId;
  label: string;
  state: 'pending' | 'active' | 'done' | 'error';
  /** Short detail shown under the step (e.g. "PostgreSQL 18 on port 54329"). */
  detail: string | null;
}

/** A network interface players' phones can reach the laptop on. */
export interface NetworkChoice {
  /** Stable id: interface name + address. */
  id: string;
  /** Interface name as the OS reports it (e.g. "Wi-Fi", "en0", "wlan0"). */
  name: string;
  /** IPv4 address (e.g. 192.168.1.20). */
  address: string;
  /** True for the interface the app picks automatically. */
  recommended: boolean;
}

export interface DesktopStatus {
  phase: ServerPhase;
  /** Startup checklist (meaningful while starting, kept afterwards). */
  steps: StartupStep[];
  /** Friendly explanation when phase === 'error' (never a raw stack). */
  error: string | null;
  /** HTTP port the game server listens on (null while stopped). */
  port: number | null;
  /** URL this computer uses (http://127.0.0.1:PORT) — the embedded admin board. */
  localUrl: string | null;
  /** URL phones on the same Wi-Fi use (http://192.168.x.x:PORT); null when no network. */
  lanUrl: string | null;
  /** Epoch ms when the server became ready. */
  startedAt: number | null;
  /** True until the first successful start (shows the welcome / admin password card). */
  firstRun: boolean;
  /** Where tournaments, logs and backups are kept. */
  dataDir: string;
  /** App version (package.json). */
  version: string;
  /** Which view fills the window: the launcher, or the embedded admin board. */
  view: 'launcher' | 'admin';
}

export interface DesktopSettings {
  /** Preferred HTTP port (default 8080); the next free one is used if busy. */
  port: number;
  /** NetworkChoice.id to advertise to players; null = automatic. */
  networkId: string | null;
  /** Show the admin board as soon as the server is ready. */
  openAdminOnStart: boolean;
  /** Keep the laptop awake while the server runs. */
  preventSleep: boolean;
  /** Allow demo tournaments with bots and speed-mode levels (for trying it out). */
  allowDemos: boolean;
  /** Start the server automatically when the app opens. */
  startOnLaunch: boolean;
}

export interface AdminCredentials {
  username: string;
  password: string;
}

export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  width: number;
  height: number;
}

export interface BackupResult {
  ok: boolean;
  /** Absolute path of the backup file when ok. */
  path: string | null;
  message: string;
}

export interface DesktopApi {
  getStatus(): Promise<DesktopStatus>;
  /** Pushes every status change; returns an unsubscribe function. */
  onStatus(listener: (status: DesktopStatus) => void): () => void;
  /** Starts PostgreSQL + the game server (no-op if already starting/running). */
  start(): Promise<void>;
  /** Stops gracefully (players are told to reconnect; tournaments resume on next start). */
  stop(): Promise<void>;
  getSettings(): Promise<DesktopSettings>;
  /** Validates and saves; port / network / demo changes apply on the next start. */
  saveSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  listNetworks(): Promise<NetworkChoice[]>;
  /** The bootstrap admin account created on first run (stored encrypted by the OS when possible). */
  getAdminCredentials(): Promise<AdminCredentials>;
  /** Shows the embedded admin board (signed in automatically) under the top bar. */
  showAdmin(): Promise<void>;
  /** Shows the launcher (start/stop, players' link, settings, logs) instead of the admin board. */
  showLauncher(): Promise<void>;
  listDisplays(): Promise<DisplayInfo[]>;
  /** Opens the broadcast screen (/display/) in its own window, fullscreen on `displayId` when given. */
  openBigScreen(options?: { displayId?: number; joinCode?: string }): Promise<void>;
  /** Opens an http(s) URL served by this server in the system browser (anything else is refused). */
  openInBrowser(url: string): Promise<void>;
  openDataFolder(): Promise<void>;
  /** Last `lines` lines of the server + database log. */
  getLogTail(lines: number): Promise<string[]>;
  /** Writes a full database backup (pg_dump) to the backups folder. */
  backupNow(): Promise<BackupResult>;
  copyText(text: string): Promise<void>;
  /** QR code of `text` as an SVG string (for the players' join link). */
  qrSvg(text: string): Promise<string>;
}

/** IPC channel names (renderer → main via ipcRenderer.invoke, main → renderer for STATUS_EVENT). */
export const CHANNELS = {
  getStatus: 'jpb:getStatus',
  statusEvent: 'jpb:status',
  start: 'jpb:start',
  stop: 'jpb:stop',
  getSettings: 'jpb:getSettings',
  saveSettings: 'jpb:saveSettings',
  listNetworks: 'jpb:listNetworks',
  getAdminCredentials: 'jpb:getAdminCredentials',
  showAdmin: 'jpb:showAdmin',
  showLauncher: 'jpb:showLauncher',
  listDisplays: 'jpb:listDisplays',
  openBigScreen: 'jpb:openBigScreen',
  openInBrowser: 'jpb:openInBrowser',
  openDataFolder: 'jpb:openDataFolder',
  getLogTail: 'jpb:getLogTail',
  backupNow: 'jpb:backupNow',
  copyText: 'jpb:copyText',
  qrSvg: 'jpb:qrSvg',
} as const;

/** Height (CSS px) of the launcher's top bar; the admin board view fills the window below it. */
export const TOP_BAR_HEIGHT = 56;

declare global {
  interface Window {
    jpbDesktop: DesktopApi;
  }
}
