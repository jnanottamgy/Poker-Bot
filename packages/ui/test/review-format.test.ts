/**
 * Review: formatter edge cases. These tests FAIL against the current src.
 */
import { describe, expect, it } from 'vitest';
import { formatChips, formatMoneyMinor, formatPercent, initials } from '../src/format';

describe('review: formatChips', () => {
  it('never prints a negative zero', () => {
    expect(formatChips(-0)).toBe('0');
    expect(formatChips(-0.4)).toBe('0');
  });
});

describe('review: formatMoneyMinor', () => {
  it('does not throw (and crash the elimination / champion screen) on a malformed currency code from the server', () => {
    expect(() => formatMoneyMinor(150_000, '')).not.toThrow();
    expect(() => formatMoneyMinor(150_000, 'RS')).not.toThrow();
  });
});

describe('review: formatPercent rounding boundary', () => {
  it('rounds exact half-tenths up (201 / 400 = 50.25% -> "50.3%")', () => {
    expect(formatPercent(201 / 400)).toBe('50.3%');
    expect(formatPercent(203 / 400)).toBe('50.8%');
  });
});

describe('review: initials', () => {
  it('does not split a surrogate pair (emoji display names render as "�")', () => {
    expect(initials('😀 Bob')).toBe('😀B');
  });
});
