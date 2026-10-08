import { formatClock, useServerCountdown } from '@jpb/ui';

/** Cosmetic countdown to a server deadline (the server decides when things happen). */
export function Countdown({ deadline, serverOffsetMs, className }: { deadline: number | null; serverOffsetMs: number; className?: string }) {
  const remaining = useServerCountdown(deadline, serverOffsetMs, { intervalMs: 250 });
  return (
    <span className={className} role="timer" aria-live="off">
      {formatClock(remaining)}
    </span>
  );
}
