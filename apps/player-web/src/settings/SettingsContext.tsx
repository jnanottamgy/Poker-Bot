import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useHaptics, useSound } from '@jpb/ui';
import type { HapticPattern, SoundName } from '@jpb/ui';
import { applySettings, loadSettings, saveSettings } from './settings';
import type { PlayerSettings } from './settings';

interface SettingsApi {
  settings: PlayerSettings;
  update: (patch: Partial<PlayerSettings>) => void;
  /** Plays a cue only if the player turned sound on. */
  play: (name: SoundName) => void;
  /** Vibrates only if supported and the player turned haptics on. */
  vibrate: (pattern: HapticPattern) => void;
  hapticsSupported: boolean;
  soundSupported: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

const SettingsContext = createContext<SettingsApi | null>(null);

export function SettingsProvider({ children, initial }: { children: ReactNode; initial?: PlayerSettings }) {
  const [settings, setSettings] = useState<PlayerSettings>(() => initial ?? loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sound = useSound(true);
  const haptics = useHaptics(settings.haptics);
  const { setMuted } = sound;

  useEffect(() => applySettings(settings), [settings]);

  // Audio may only start after a user gesture: (re)unmute on the first tap when sound is on.
  useEffect(() => {
    if (!settings.sound) {
      setMuted(true);
      return undefined;
    }
    setMuted(false);
    const resume = () => setMuted(false);
    window.addEventListener('pointerdown', resume, { once: true });
    return () => window.removeEventListener('pointerdown', resume);
  }, [settings.sound, setMuted]);

  const update = useCallback((patch: Partial<PlayerSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const value = useMemo<SettingsApi>(
    () => ({
      settings,
      update,
      play: sound.play,
      vibrate: (p) => void haptics.vibrate(p),
      hapticsSupported: haptics.supported,
      soundSupported: sound.supported,
      settingsOpen,
      setSettingsOpen,
    }),
    [settings, update, sound.play, sound.supported, haptics, settingsOpen],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const s = useContext(SettingsContext);
  if (!s) throw new Error('SettingsProvider missing');
  return s;
}
