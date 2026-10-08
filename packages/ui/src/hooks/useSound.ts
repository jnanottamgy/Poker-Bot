import { useCallback, useEffect, useRef, useState } from 'react';

export type SoundName = 'deal' | 'your-turn' | 'timer-warning' | 'elimination' | 'big-pot' | 'final-table';

interface Tone {
  /** Frequency in Hz. */
  f: number;
  /** Start offset (s). */
  at: number;
  /** Duration (s). */
  d: number;
  type: OscillatorType;
  /** Peak gain (0..1). Kept low: these are cues, not music. */
  g: number;
}

/**
 * Synthesized cues (Web Audio, no audio files). Each is < 1s and quiet.
 * Pitches are chosen so cues are distinguishable without being musical noise.
 */
export const SOUND_RECIPES: Readonly<Record<SoundName, readonly Tone[]>> = {
  deal: [{ f: 1800, at: 0, d: 0.035, type: 'triangle', g: 0.06 }],
  'your-turn': [
    { f: 660, at: 0, d: 0.12, type: 'sine', g: 0.12 },
    { f: 990, at: 0.11, d: 0.18, type: 'sine', g: 0.12 },
  ],
  'timer-warning': [
    { f: 880, at: 0, d: 0.07, type: 'square', g: 0.04 },
    { f: 880, at: 0.16, d: 0.07, type: 'square', g: 0.04 },
  ],
  elimination: [
    { f: 392, at: 0, d: 0.22, type: 'sine', g: 0.1 },
    { f: 262, at: 0.2, d: 0.42, type: 'sine', g: 0.1 },
  ],
  'big-pot': [
    { f: 523, at: 0, d: 0.1, type: 'triangle', g: 0.09 },
    { f: 659, at: 0.08, d: 0.1, type: 'triangle', g: 0.09 },
    { f: 784, at: 0.16, d: 0.22, type: 'triangle', g: 0.09 },
  ],
  'final-table': [
    { f: 392, at: 0, d: 0.3, type: 'sine', g: 0.08 },
    { f: 523, at: 0.18, d: 0.3, type: 'sine', g: 0.08 },
    { f: 659, at: 0.36, d: 0.3, type: 'sine', g: 0.08 },
    { f: 784, at: 0.54, d: 0.45, type: 'sine', g: 0.08 },
  ],
};

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function scheduleTone(ctx: AudioContext, tone: Tone): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + tone.at;
  osc.type = tone.type;
  osc.frequency.setValueAtTime(tone.f, t0);
  // Short attack + exponential release avoids clicks.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(tone.g, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.d);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + tone.d + 0.02);
}

export interface SoundControls {
  supported: boolean;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** Plays a cue; silently does nothing while muted or unsupported. */
  play: (name: SoundName) => void;
}

/**
 * Sound cues. MUTED BY DEFAULT: the user must unmute (a user gesture, which
 * also satisfies browser autoplay rules). The AudioContext is created lazily.
 */
export function useSound(initialMuted = true): SoundControls {
  const [muted, setMutedState] = useState(initialMuted);
  const ctxRef = useRef<AudioContext | null>(null);
  const supported = audioContextCtor() !== null;

  const ensureContext = useCallback((): AudioContext | null => {
    if (ctxRef.current) return ctxRef.current;
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      ctxRef.current = new Ctor();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  const setMuted = useCallback(
    (next: boolean) => {
      setMutedState(next);
      if (!next) void ensureContext()?.resume().catch(() => undefined);
    },
    [ensureContext],
  );

  const play = useCallback(
    (name: SoundName) => {
      if (muted) return;
      const ctx = ensureContext();
      if (!ctx) return;
      try {
        for (const tone of SOUND_RECIPES[name]) scheduleTone(ctx, tone);
      } catch {
        // Audio is decoration; never let it break the table.
      }
    },
    [muted, ensureContext],
  );

  useEffect(
    () => () => {
      void ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    },
    [],
  );

  return { supported, muted, setMuted, play };
}
