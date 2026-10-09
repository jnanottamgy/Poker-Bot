import { currencyLocale, currencyMinorDigits, formatChips } from '@jpb/ui';

/**
 * Text ⇄ value conversions for the wizard's inputs. A field that cannot be
 * parsed commits NaN, which @jpb/validation reports on that exact field
 * ("Enter a number."), so a half-typed value can never be saved.
 */

const SEPARATORS = /[,\s_]/g;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Number typed in display units → stored value (`× scale`). Accepts "10,000",
 * "2.5" (when decimals are allowed) and "1_000"; anything else → NaN.
 */
export function parseNumberText(text: string, opts: { scale?: number; decimals?: boolean } = {}): number {
  const t = text.replace(SEPARATORS, '');
  const pattern = opts.decimals ? /^-?(\d+\.?\d*|\.\d+)$/ : /^-?\d+$/;
  if (!pattern.test(t)) return Number.NaN;
  const n = Number(t) * (opts.scale ?? 1);
  // Scaling "0.005" s by 1000 must give exactly 5 ms, not 4.999…: drop binary noise.
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : Number.NaN;
}

/** Stored value → text in display units (no grouping while editing). */
export function numberText(value: unknown, opts: { scale?: number; grouping?: boolean } = {}): string {
  if (!isNum(value)) return '';
  const shown = value / (opts.scale ?? 1);
  if (opts.grouping && Number.isInteger(shown)) return formatChips(shown);
  return String(Math.round(shown * 1e6) / 1e6);
}

/**
 * Durations: "8" = 8 minutes, "8:30" = 8 min 30 s, "45s", "1.5m", "2h".
 * Returns whole seconds, or NaN.
 */
export function parseDurationText(text: string): number {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (t === '') return Number.NaN;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+)$/))) return Number(m[1]) * SECONDS_PER_MINUTE;
  if ((m = t.match(/^(\d+):([0-5]?\d)$/))) return Number(m[1]) * SECONDS_PER_MINUTE + Number(m[2]);
  if ((m = t.match(/^(\d+(?:\.\d+)?)(?:s|sec|secs|seconds?)$/))) return Math.round(Number(m[1]));
  if ((m = t.match(/^(\d+(?:\.\d+)?)(?:m|min|mins|minutes?)?$/))) return Math.round(Number(m[1]) * SECONDS_PER_MINUTE);
  if ((m = t.match(/^(\d+(?:\.\d+)?)(?:h|hr|hrs|hours?)$/))) return Math.round(Number(m[1]) * SECONDS_PER_HOUR);
  return Number.NaN;
}

/** Seconds → "8" (whole minutes) or "0:10" (m:ss). */
export function durationText(seconds: unknown): string {
  if (!isNum(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  if (s % SECONDS_PER_MINUTE === 0) return String(s / SECONDS_PER_MINUTE);
  return `${Math.floor(s / SECONDS_PER_MINUTE)}:${String(s % SECONDS_PER_MINUTE).padStart(2, '0')}`;
}

/** Seconds → "8 min", "1 h 30 min", "45 s", "2 min 10 s". */
export function durationLabel(seconds: number): string {
  if (!isNum(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / SECONDS_PER_HOUR);
  const m = Math.floor((s % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const sec = s % SECONDS_PER_MINUTE;
  const parts: string[] = [];
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (sec || parts.length === 0) parts.push(`${sec} s`);
  return parts.join(' ');
}

/**
 * Money typed in major units ("1,500.50") → integer minor units, exact
 * (string arithmetic, no floating point). NaN when malformed, negative,
 * over-precise or beyond the safe integer range.
 */
export function parseMoneyText(text: string, currency: string): number {
  const digits = currencyMinorDigits(currency);
  const t = text.replace(SEPARATORS, '');
  const m = t.match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return Number.NaN;
  const frac = m[2] ?? '';
  if (frac.length > digits) return Number.NaN;
  const minor = BigInt(m[1] || '0') * 10n ** BigInt(digits) + BigInt((frac + '0'.repeat(digits)).slice(0, digits) || '0');
  return minor > BigInt(Number.MAX_SAFE_INTEGER) ? Number.NaN : Number(minor);
}

/** Integer minor units → "1500.5" style text in major units (plain, for editing). */
export function moneyText(minor: unknown, currency: string, grouping = false): string {
  if (!isNum(minor)) return '';
  const digits = currencyMinorDigits(currency);
  const factor = 10 ** digits;
  const whole = Math.trunc(minor / factor);
  const frac = Math.abs(minor % factor);
  const wholeText = grouping ? new Intl.NumberFormat(currencyLocale(currency), { maximumFractionDigits: 0 }).format(whole) : String(whole);
  return frac === 0 ? wholeText : `${wholeText}.${String(frac).padStart(digits, '0')}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Epoch ms → value for <input type="datetime-local"> in the browser's time zone. */
export function dateTimeLocalText(epochMs: number | null): string {
  if (epochMs === null || !isNum(epochMs)) return '';
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → epoch ms (browser time zone), null when empty, NaN when invalid. */
export function parseDateTimeLocal(text: string): number | null {
  if (text.trim() === '') return null;
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return Number.NaN;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return Number.isNaN(d.getTime()) ? Number.NaN : d.getTime();
}

/** The browser's IANA time zone, e.g. "Asia/Kolkata" (display only). */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return 'local time';
  }
}

/** Big blinds a stack represents, e.g. "100 BB", "33.3 BB". */
export function bbText(stack: number, bigBlind: number): string {
  if (!isNum(stack) || !isNum(bigBlind) || bigBlind <= 0) return '—';
  const bb = stack / bigBlind;
  return `${bb >= 100 || Number.isInteger(bb) ? formatChips(Math.round(bb)) : (Math.round(bb * 10) / 10).toString()} BB`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatChips(n)} ${n === 1 ? one : many}`;
}
