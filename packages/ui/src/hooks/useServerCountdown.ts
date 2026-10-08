import { useEffect, useRef, useState } from 'react';

/**
 * Remaining time until a SERVER deadline, measured on the client.
 *
 * `serverOffsetMs` = serverNow - clientNow (estimated from pong/`st` frames).
 * The server is authoritative: this value is visual only and never decides
 * whether an action is accepted.
 */
export function remainingMs(deadline: number | null, clientNow: number, serverOffsetMs: number): number {
  if (deadline === null || !Number.isFinite(deadline)) return 0;
  const serverNow = clientNow + (Number.isFinite(serverOffsetMs) ? serverOffsetMs : 0);
  return Math.max(0, deadline - serverNow);
}

export interface ServerCountdownOptions {
  /** Update period in ms. Default 200 (smooth seconds, cheap on phones). */
  intervalMs?: number;
  /** Injected clock for tests. Default Date.now. */
  now?: () => number;
}

/** Returns remaining ms until `deadline` (server epoch ms); 0 when null or passed. */
export function useServerCountdown(
  deadline: number | null,
  serverOffsetMs: number,
  options: ServerCountdownOptions = {},
): number {
  const { intervalMs = 200, now = Date.now } = options;
  // Kept in a ref so an inline `now` does not restart the interval every render.
  const nowRef = useRef(now);
  nowRef.current = now;
  // The value is stored WITH the inputs it was computed for. When the deadline
  // (or offset) changes, the first render derives a fresh value instead of
  // returning the previous deadline's number (which flashed "00:00 / HURRY").
  const [state, setState] = useState(() => ({ deadline, off: serverOffsetMs, ms: remainingMs(deadline, now(), serverOffsetMs) }));
  const current = state.deadline === deadline && state.off === serverOffsetMs ? state.ms : remainingMs(deadline, nowRef.current(), serverOffsetMs);
  const period = Math.max(50, Number.isFinite(intervalMs) ? intervalMs : 200);

  useEffect(() => {
    const tick = (): number => {
      const r = remainingMs(deadline, nowRef.current(), serverOffsetMs);
      setState({ deadline, off: serverOffsetMs, ms: r });
      return r;
    };
    if (tick() <= 0) return undefined;
    const id = setInterval(() => {
      if (tick() <= 0) clearInterval(id);
    }, period);
    return () => clearInterval(id);
  }, [deadline, serverOffsetMs, period]);

  return current;
}
