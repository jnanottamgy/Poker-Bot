/**
 * Pure display formatters. No locale is taken from the environment: chip
 * counts must read identically on every device at the same table.
 */
import type { CardCode, RankChar, SuitChar } from '@jpb/shared-types';

const CHIP_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Exact chip count with thousands separators: 10000 -> "10,000". */
export function formatChips(n: number): string {
  if (!Number.isFinite(n)) return '0';
  // `|| 0` turns -0 (from -0 or -0.4) into 0: Intl would print "-0".
  return CHIP_FORMAT.format(Math.trunc(n) || 0);
}

/** Plain integer count with separators (players, tables, hands). */
export function formatCount(n: number): string {
  return formatChips(n);
}

const COMPACT_UNITS: ReadonlyArray<{ value: number; suffix: string }> = [
  { value: 1_000_000_000_000, suffix: 'T' },
  { value: 1_000_000_000, suffix: 'B' },
  { value: 1_000_000, suffix: 'M' },
  { value: 1_000, suffix: 'K' },
];

/**
 * Compact chip count: 999 -> "999", 12500 -> "12.5K", 125000 -> "125K",
 * 1250000 -> "1.2M".
 *
 * ROUNDING RULE: the value is TRUNCATED (toward zero) to one decimal of its
 * unit, never rounded. A compact stack therefore never overstates the real
 * stack and never jumps across a unit boundary: 999,950 -> "999.9K" (not
 * "1M"), 1,999 -> "1.9K" (not "2K"). Trailing ".0" is dropped. The exact
 * amount must always be available next to it (title / tap-to-reveal).
 */
export function formatChipsCompact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const int = Math.trunc(n);
  const sign = int < 0 ? '-' : '';
  const abs = Math.abs(int);
  for (const unit of COMPACT_UNITS) {
    if (abs >= unit.value) {
      // Integer arithmetic only: tenths of the unit, truncated.
      const tenths = Math.floor(abs / (unit.value / 10));
      const whole = Math.floor(tenths / 10);
      const frac = tenths % 10;
      const body = frac === 0 ? String(whole) : `${whole}.${frac}`;
      return `${sign}${body}${unit.suffix}`;
    }
  }
  return `${sign}${abs}`;
}

/** Signed chip delta: +1,200 / -500 / 0. */
export function formatChipsDelta(n: number): string {
  if (n > 0) return `+${formatChips(n)}`;
  if (n < 0) return `-${formatChips(-n)}`;
  return '0';
}

/** Locale used for a currency's digit grouping. INR uses Indian grouping (1,00,000). */
export function currencyLocale(currency: string): string {
  return currency.toUpperCase() === 'INR' ? 'en-IN' : 'en-US';
}

/** Number of minor units in one major unit for a currency (INR 2, JPY 0, ...). */
export function currencyMinorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Fallback for a missing / malformed currency code from the server (never throw during render). */
export const DEFAULT_CURRENCY = 'INR';

function safeCurrency(currency: string): string {
  return /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : DEFAULT_CURRENCY;
}

/**
 * Money in integer minor units -> display string via Intl.
 * 10000000 INR (paise) -> "₹1,00,000"; 12345 USD (cents) -> "$123.45".
 * Whole amounts drop the ".00"; fractional amounts always show every minor digit.
 */
export function formatMoneyMinor(minor: number, currency: string = DEFAULT_CURRENCY): string {
  const code = safeCurrency(typeof currency === 'string' ? currency : '');
  const digits = currencyMinorDigits(code);
  const factor = 10 ** digits;
  const safeMinor = Number.isFinite(minor) ? Math.trunc(minor) : 0;
  const whole = safeMinor % factor === 0;
  try {
    return new Intl.NumberFormat(currencyLocale(code), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(safeMinor / factor);
  } catch {
    // A three-letter code Intl does not know (e.g. "XYZ" on an old engine).
    return `${code} ${formatChips(Math.trunc(safeMinor / factor))}`;
  }
}

/**
 * Countdown clock. Seconds are rounded UP so the display only reads "00:00"
 * when no time is left: 271000 -> "04:31", 3725000 -> "1:02:05".
 * Negative / NaN -> "00:00".
 */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Whole seconds remaining (rounded up), never negative. */
export function secondsLeft(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/** English ordinal: 1 -> "1st", 22 -> "22nd", 113 -> "113th". */
export function formatOrdinal(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  let suffix = 'th';
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = 'st';
    else if (mod10 === 2) suffix = 'nd';
    else if (mod10 === 3) suffix = 'rd';
  }
  return `${formatCount(Math.trunc(n))}${suffix}`;
}

/** Percent with one decimal max: 0.4567 -> "45.7%". */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '0%';
  // toPrecision(12) removes binary noise first (201/400*1000 = 502.49999999999994),
  // so exact half-tenths round up: 50.25% -> "50.3%".
  const v = Math.round(Number((ratio * 1000).toPrecision(12))) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

/* ---------------------------------------------------------------- cards -- */

const RANK_DISPLAY: Readonly<Record<RankChar, string>> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
};

const RANK_NAMES: Readonly<Record<RankChar, string>> = {
  '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight',
  '9': 'Nine', T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace',
};

const SUIT_NAMES: Readonly<Record<SuitChar, string>> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const SUIT_GLYPHS: Readonly<Record<SuitChar, string>> = { c: '♣', d: '♦', h: '♥', s: '♠' };

/** Splits and validates a card code. Returns null for anything that is not a real card. */
export function parseCard(code: string): { rank: RankChar; suit: SuitChar } | null {
  if (code.length !== 2) return null;
  const rank = code[0] as RankChar;
  const suit = code[1] as SuitChar;
  if (!(rank in RANK_DISPLAY) || !(suit in SUIT_NAMES)) return null;
  return { rank, suit };
}

/** 'T' -> '10'; every other rank char displays as itself. */
export function rankDisplay(rank: RankChar): string {
  return RANK_DISPLAY[rank];
}

export function suitName(suit: SuitChar): string {
  return SUIT_NAMES[suit];
}

export function suitGlyph(suit: SuitChar): string {
  return SUIT_GLYPHS[suit];
}

export function isRedSuit(suit: SuitChar): boolean {
  return suit === 'h' || suit === 'd';
}

/** Screen-reader label: 'As' -> "Ace of spades", 'Td' -> "Ten of diamonds". */
export function cardLabel(code: CardCode | string): string {
  const parsed = parseCard(code);
  if (!parsed) return 'Unknown card';
  return `${RANK_NAMES[parsed.rank]} of ${SUIT_NAMES[parsed.suit]}`;
}

/** Short visual text: 'Td' -> "10♦". */
export function cardShort(code: CardCode | string): string {
  const parsed = parseCard(code);
  if (!parsed) return '?';
  return `${RANK_DISPLAY[parsed.rank]}${SUIT_GLYPHS[parsed.suit]}`;
}

/** First user-perceived character (code point, so an emoji is never split into a lone surrogate). */
function firstGlyph(s: string): string {
  return Array.from(s)[0] ?? '';
}

/** Initials for avatar discs: "Johnny Chan" -> "JC", "ace" -> "A", "😀 Bob" -> "😀B". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = firstGlyph(parts[0] ?? '');
  const last = parts.length > 1 ? firstGlyph(parts[parts.length - 1] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Short seat name for narrow pods: "Diego Alvarez" -> "Diego A.". A single
 * word is returned unchanged; the full name always stays in the accessible label.
 */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim();
  return `${parts[0]} ${firstGlyph(parts[parts.length - 1] ?? '').toUpperCase()}.`;
}
