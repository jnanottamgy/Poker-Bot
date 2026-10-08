/** Display-only time helpers. All inputs are server epoch ms or durations in ms. */

const pad = (n: number): string => String(n).padStart(2, '0');

/** "3h 14m", "12m 05s", "42s". Negative input is treated as 0. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/** Local wall-clock "21:04:17" (24h). */
export function formatTimeOfDay(epochMs: number, withSeconds = true): string {
  const d = new Date(epochMs);
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base;
}

/** "12 Mar 2026, 18:00" */
export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  const month = d.toLocaleString('en-GB', { month: 'short' });
  return `${d.getDate()} ${month} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "just now", "12s ago", "4m ago", "2h ago", "3d ago". */
export function formatAgo(deltaMs: number): string {
  const s = Math.max(0, Math.round(deltaMs / 1000));
  if (s < 3) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
