import type { PrizePlace } from '@jpb/shared-types';

/** "Sat 12 Oct · 7:30 PM" in the player's locale and time zone. */
export function formatStartTime(at: number | null, now: number = Date.now()): string {
  if (at === null) return 'To be announced';
  const d = new Date(at);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today · ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`;
}

export function prizePool(places: readonly PrizePlace[]): number {
  return places.reduce((sum, p) => sum + p.amountMinor, 0);
}
