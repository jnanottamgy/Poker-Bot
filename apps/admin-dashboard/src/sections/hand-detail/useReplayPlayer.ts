import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReplayFrame } from './replay';
import { frameDurationMs } from './replay';

export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface ReplayPlayer {
  index: number;
  playing: boolean;
  speed: ReplaySpeed;
  atStart: boolean;
  atEnd: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  step: (delta: number) => void;
  seek: (index: number) => void;
  setSpeed: (s: ReplaySpeed) => void;
}

/**
 * Playback state of a replay: play / pause / step / seek / speed. Timers are
 * display-only (setTimeout); the frames themselves are fixed data, so
 * stepping back and forth always shows exactly the same states.
 */
export function useReplayPlayer(frames: readonly ReplayFrame[], initialIndex = 0): ReplayPlayer {
  const last = Math.max(0, frames.length - 1);
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), last));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const indexRef = useRef(index);
  indexRef.current = index;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // A new hand (different frame count) starts from the beginning.
  useEffect(() => {
    setIndex((i) => Math.min(i, last));
  }, [last]);

  useEffect(() => {
    if (!playing) return undefined;
    if (index >= last) {
      setPlaying(false);
      return undefined;
    }
    const kind = frames[index + 1]?.kind ?? 'action';
    const t = setTimeout(() => setIndex((i) => Math.min(last, i + 1)), frameDurationMs(kind) / speed);
    return () => clearTimeout(t);
  }, [playing, index, last, speed, frames]);

  const play = useCallback(() => {
    if (indexRef.current >= last) setIndex(0);
    setPlaying(true);
  }, [last]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [play, pause]);
  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      setIndex((i) => Math.min(last, Math.max(0, i + delta)));
    },
    [last],
  );
  const seek = useCallback(
    (i: number) => {
      setPlaying(false);
      setIndex(Math.min(last, Math.max(0, Math.round(i))));
    },
    [last],
  );

  return { index, playing, speed, atStart: index === 0, atEnd: index >= last, play, pause, toggle, step, seek, setSpeed };
}

/**
 * Animates a list of integers toward new values (stack counters). Purely
 * cosmetic: the last frame is always exactly `values`; reduced motion or no
 * requestAnimationFrame (tests) returns the values immediately.
 */
export function useAnimatedValues(values: readonly number[], durationMs: number, reduced: boolean): number[] {
  const signature = values.join(',');
  const [shown, setShown] = useState<number[]>(() => values.slice());
  const shownRef = useRef<number[]>(shown);
  shownRef.current = shown;

  useEffect(() => {
    const target = values.slice();
    const from = shownRef.current.length === target.length ? shownRef.current.slice() : target.slice();
    if (reduced || durationMs <= 0 || typeof requestAnimationFrame !== 'function' || from.every((v, i) => v === target[i])) {
      setShown(target);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const k = 1 - (1 - p) ** 3;
      setShown(p >= 1 ? target : target.map((v, i) => Math.round(from[i]! + (v - from[i]!) * k)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `signature` is the identity of `values` (a new array every render).
  }, [signature, reduced, durationMs]);

  return reduced ? values.slice() : shown;
}
