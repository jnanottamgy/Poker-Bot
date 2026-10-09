import { useEffect, useState } from 'react';

/**
 * Client wall clock that re-renders every `intervalMs` — for display-only
 * "4m ago" / "open for 12s" labels. Never used for game logic (server time
 * arrives with the data).
 */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
