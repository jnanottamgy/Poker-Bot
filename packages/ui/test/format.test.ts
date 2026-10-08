import { describe, expect, it } from 'vitest';
import {
  cardLabel,
  cardShort,
  currencyLocale,
  formatChips,
  formatChipsCompact,
  formatChipsDelta,
  formatClock,
  formatCount,
  formatMoneyMinor,
  formatOrdinal,
  formatPercent,
  initials,
  isRedSuit,
  parseCard,
  rankDisplay,
  secondsLeft,
} from '../src/format';
import { CANONICAL_DECK } from '@jpb/shared-types';

describe('formatChips', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1,000'],
    [10000, '10,000'],
    [1234567, '1,234,567'],
    [60_000_000, '60,000,000'],
  ])('%d -> %s', (n, out) => expect(formatChips(n)).toBe(out));

  it('truncates non-integers and guards non-finite input', () => {
    expect(formatChips(10.9)).toBe('10');
    expect(formatChips(Number.NaN)).toBe('0');
    expect(formatChips(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('formatCount uses the same grouping', () => expect(formatCount(2000)).toBe('2,000'));
});

describe('formatChipsCompact', () => {
  it.each([
    [0, '0'],
    [5, '5'],
    [999, '999'],
    [1000, '1K'],
    [1050, '1K'],
    [1099, '1K'],
    [1100, '1.1K'],
    [1250, '1.2K'],
    [1999, '1.9K'],
    [12_500, '12.5K'],
    [99_999, '99.9K'],
    [125_000, '125K'],
    [125_400, '125.4K'],
    [999_950, '999.9K'],
    [999_999, '999.9K'],
    [1_000_000, '1M'],
    [1_250_000, '1.2M'],
    [1_299_999, '1.2M'],
    [12_500_000, '12.5M'],
    [999_999_999, '999.9M'],
    [1_000_000_000, '1B'],
    [2_750_000_000, '2.7B'],
    [3_000_000_000_000, '3T'],
  ])('%d -> %s', (n, out) => expect(formatChipsCompact(n)).toBe(out));

  it('never rounds up across a boundary (displayed value <= real value)', () => {
    const parse = (s: string): number => {
      const m = /^(-?[\d.]+)([KMBT]?)$/.exec(s);
      if (!m) throw new Error(s);
      const mult = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2] as '' | 'K' | 'M' | 'B' | 'T'];
      return Number(m[1]) * mult;
    };
    for (let n = 0; n < 3_000_000; n += 997) {
      const shown = parse(formatChipsCompact(n));
      expect(shown).toBeLessThanOrEqual(n);
      // and never loses more than 10% of the unit
      expect(n - shown).toBeLessThan(n >= 1e6 ? 1e5 : n >= 1e3 ? 100 : 1);
    }
  });

  it('handles negatives symmetrically and non-finite input', () => {
    expect(formatChipsCompact(-12_500)).toBe('-12.5K');
    expect(formatChipsCompact(-999)).toBe('-999');
    expect(formatChipsCompact(Number.NaN)).toBe('0');
  });
});

describe('formatChipsDelta', () => {
  it('signs deltas', () => {
    expect(formatChipsDelta(1200)).toBe('+1,200');
    expect(formatChipsDelta(-500)).toBe('-500');
    expect(formatChipsDelta(0)).toBe('0');
  });
});

describe('formatMoneyMinor', () => {
  it('uses Indian grouping for INR', () => {
    expect(currencyLocale('INR')).toBe('en-IN');
    expect(formatMoneyMinor(10_000_000, 'INR')).toBe('₹1,00,000');
    expect(formatMoneyMinor(50_000_000, 'INR')).toBe('₹5,00,000');
    expect(formatMoneyMinor(1_234_567_800, 'INR')).toBe('₹1,23,45,678');
  });
  it('shows minor digits only when needed', () => {
    expect(formatMoneyMinor(12_345, 'INR')).toBe('₹123.45');
    expect(formatMoneyMinor(12_305, 'USD')).toBe('$123.05');
    expect(formatMoneyMinor(100_000, 'USD')).toBe('$1,000');
    expect(formatMoneyMinor(0, 'INR')).toBe('₹0');
  });
  it('respects zero-decimal currencies', () => {
    expect(formatMoneyMinor(5000, 'JPY')).toBe('¥5,000');
  });
  it('defaults to INR and is case-insensitive', () => {
    expect(formatMoneyMinor(10_000_000)).toBe('₹1,00,000');
    expect(formatMoneyMinor(100, 'inr')).toBe('₹1');
  });
});

describe('formatClock', () => {
  it.each([
    [0, '00:00'],
    [-5000, '00:00'],
    [Number.NaN, '00:00'],
    [1, '00:01'],
    [999, '00:01'],
    [1000, '00:01'],
    [1001, '00:02'],
    [59_000, '00:59'],
    [60_000, '01:00'],
    [271_000, '04:31'],
    [270_001, '04:31'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_725_000, '1:02:05'],
    [36_000_000, '10:00:00'],
  ])('%d ms -> %s', (ms, out) => expect(formatClock(ms)).toBe(out));

  it('secondsLeft rounds up and clamps', () => {
    expect(secondsLeft(4001)).toBe(5);
    expect(secondsLeft(5000)).toBe(5);
    expect(secondsLeft(-1)).toBe(0);
  });
});

describe('ordinal & percent & initials', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [112, '112th'],
    [184, '184th'],
    [1001, '1,001st'],
  ])('%d -> %s', (n, out) => expect(formatOrdinal(n)).toBe(out));

  it('formats percent', () => {
    expect(formatPercent(0.4567)).toBe('45.7%');
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(Number.NaN)).toBe('0%');
  });

  it('initials', () => {
    expect(initials('Johnny Chan')).toBe('JC');
    expect(initials('ace')).toBe('A');
    expect(initials('  ')).toBe('?');
    expect(initials('Mary Jane Watson')).toBe('MW');
  });
});

describe('cards', () => {
  it('labels cards for screen readers', () => {
    expect(cardLabel('As')).toBe('Ace of spades');
    expect(cardLabel('Td')).toBe('Ten of diamonds');
    expect(cardLabel('2c')).toBe('Two of clubs');
    expect(cardLabel('Qh')).toBe('Queen of hearts');
    expect(cardLabel('Xx')).toBe('Unknown card');
  });
  it('displays T as 10', () => {
    expect(rankDisplay('T')).toBe('10');
    expect(rankDisplay('A')).toBe('A');
    expect(cardShort('Td')).toBe('10♦');
  });
  it('parses all 52 canonical cards and rejects junk', () => {
    for (const c of CANONICAL_DECK) expect(parseCard(c)).not.toBeNull();
    expect(new Set(CANONICAL_DECK.map(cardLabel)).size).toBe(52);
    expect(parseCard('1s')).toBeNull();
    expect(parseCard('As ')).toBeNull();
    expect(parseCard('')).toBeNull();
  });
  it('knows red suits', () => {
    expect(isRedSuit('h')).toBe(true);
    expect(isRedSuit('d')).toBe(true);
    expect(isRedSuit('s')).toBe(false);
    expect(isRedSuit('c')).toBe(false);
  });
});
