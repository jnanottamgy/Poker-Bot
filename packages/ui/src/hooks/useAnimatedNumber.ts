import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useReducedMotion } from './useReducedMotion';

/** Ease-out cubic: fast start, gentle landing. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Short count-up/down toward `value` (integers only). Purely cosmetic: the
 * final frame is always exactly `value`, and with reduced motion (or a
 * duration of 0) the value is returned immediately. Pass `scope` (a ref to
 * the rendered element) to honour data-motion="reduced" on any ancestor.
 */
export function useAnimatedNumber(value: number, durationMs = 450, scope?: RefObject<Element | null>): number {
  const reduced = useReducedMotion(scope);
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    if (reduced || durationMs <= 0 || from === value || typeof requestAnimationFrame !== 'function') {
      fromRef.current = value;
      setDisplay(value);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const step = (t: number): void => {
      const p = Math.min(1, (t - start) / durationMs);
      const next = p >= 1 ? value : Math.round(from + (value - from) * easeOut(p));
      fromRef.current = next;
      setDisplay(next);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, durationMs]);

  return reduced ? value : display;
}
