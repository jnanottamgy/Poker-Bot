/**
 * Device preferences. Persisted in localStorage (never secrets: no session,
 * no rejoin code) and applied as theme switches on <html> (see @jpb/ui).
 */
export interface PlayerSettings {
  sound: boolean;
  haptics: boolean;
  fourColorDeck: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  sound: false,
  haptics: false,
  fourColorDeck: false,
  reducedMotion: false,
  highContrast: false,
};

export const SETTINGS_KEY = 'jpb.player.settings.v1';
export const LAST_JOIN_KEY = 'jpb.player.lastJoinCode';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(s: StorageLike | null = storage()): PlayerSettings {
  try {
    const raw = s?.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof PlayerSettings, unknown>>;
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof PlayerSettings>) {
      if (typeof parsed[k] === 'boolean') out[k] = parsed[k] as boolean;
    }
    return out;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: PlayerSettings, s: StorageLike | null = storage()): void {
  try {
    s?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / quota: settings stay for this visit only */
  }
}

/** Theme switches understood by @jpb/ui styles. */
export function applySettings(settings: PlayerSettings, root: HTMLElement = document.documentElement): void {
  const set = (attr: string, value: string | null) => (value === null ? root.removeAttribute(attr) : root.setAttribute(attr, value));
  set('data-deck', settings.fourColorDeck ? 'four-color' : null);
  set('data-motion', settings.reducedMotion ? 'reduced' : null);
  set('data-contrast', settings.highContrast ? 'high' : null);
}

export function rememberJoinCode(joinCode: string, s: StorageLike | null = storage()): void {
  try {
    s?.setItem(LAST_JOIN_KEY, joinCode);
  } catch {
    /* ignore */
  }
}

export function lastJoinCode(s: StorageLike | null = storage()): string | null {
  try {
    return s?.getItem(LAST_JOIN_KEY) ?? null;
  } catch {
    return null;
  }
}
