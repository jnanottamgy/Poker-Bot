import { useCallback, useMemo } from 'react';

export type HapticPattern = 'tap' | 'your-turn' | 'warning' | 'elimination' | 'success';

/** Vibration patterns (ms on/off). Short and distinct; never longer than ~400ms total. */
export const HAPTIC_PATTERNS: Readonly<Record<HapticPattern, number | number[]>> = {
  tap: 10,
  'your-turn': [30, 60, 30],
  warning: [60, 40, 60],
  elimination: [120],
  success: [20, 40, 20, 40, 60],
};

export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export interface Haptics {
  supported: boolean;
  /** No-op unless supported AND enabled by the user. Returns whether a vibration was requested. */
  vibrate: (pattern: HapticPattern) => boolean;
}

/** Haptic feedback is opt-in: `enabled` must come from an explicit user setting. */
export function useHaptics(enabled: boolean): Haptics {
  const supported = useMemo(hapticsSupported, []);
  const vibrate = useCallback(
    (pattern: HapticPattern): boolean => {
      if (!enabled || !supported) return false;
      try {
        return navigator.vibrate(HAPTIC_PATTERNS[pattern]);
      } catch {
        return false;
      }
    },
    [enabled, supported],
  );
  return { supported, vibrate };
}
