import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  codePointLength,
  containsMarkup,
  hasExcessiveCombiningMarks,
  hasLetterOrDigit,
  sanitizeMultilineText,
  sanitizeText,
  utf8ByteLength,
} from '../src';

const INVISIBLE_PROBE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Default_Ignorable_Code_Point}\u2800]/u;

const anyText = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 60 }),
  fc.string({ unit: 'grapheme', maxLength: 30 }),
  fc
    .array(
      fc.constantFrom('a', 'B', ' ', '\t', '\n', '\r', '\u0000', '\u200B', '\u200D', '\u202E', '\u2066', '\uFEFF', '\u00A0', '\u3000', 'Ｆ', 'ﬁ', 'é', 'e', '\u0301', '\u00AD', '\u3164', '\uFE0F', '\u{E0041}', '\uD800', '<', '&', '\u2028', 'Ａ', '\u0085'),
      { maxLength: 40 },
    )
    .map((parts) => parts.join('')),
);

describe('sanitizeText', () => {
  it.each([
    ['  John   Smith  ', 'John Smith'],
    ['John\tSmith', 'John Smith'],
    ['John\r\nSmith', 'John Smith'],
    ['Jo\u200Bhn', 'John'],
    ['Jo\u200Dhn', 'John'],
    ['\uFEFFAlice', 'Alice'],
    ['Al\u00ADice', 'Alice'],
    ['evil\u202Etxt.exe', 'eviltxt.exe'],
    ['\u2066isolate\u2069', 'isolate'],
    ['Ａｌｉｃｅ', 'Alice'],
    ['ﬁsh', 'fish'],
    ['e\u0301', 'é'],
    ['e\u200B\u0301', 'é'],
    ['a\u00A0b', 'a b'],
    ['a\u3000b', 'a b'],
    ['\u3164', ''],
    ['\u2800\u2800', ''],
    ['tag\u{E0041}s', 'tags'],
    ['nul\u0000l', 'null'],
    ['bell\u0007', 'bell'],
    ['\u0085x\u2028y\u2029', 'x y'],
    ['❤\uFE0F', '❤'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeText(input)).toBe(expected);
  });

  it('is idempotent and leaves no invisible characters, edge spaces or doubled spaces (property)', () => {
    fc.assert(
      fc.property(anyText, (raw) => {
        const once = sanitizeText(raw);
        expect(sanitizeText(once)).toBe(once);
        expect(INVISIBLE_PROBE.test(once)).toBe(false);
        expect(once).toBe(once.trim());
        expect(/\s\s/u.test(once)).toBe(false);
        expect(/[\n\r\t]/.test(once)).toBe(false);
        expect(once.normalize('NFKC')).toBe(once);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('sanitizeMultilineText', () => {
  it('keeps paragraphs, trims lines, caps blank lines at one', () => {
    expect(sanitizeMultilineText('  First line  \r\n\r\n\r\n\r\n  Second\u200B line\t\tend  ')).toBe('First line\n\nSecond line end');
    expect(sanitizeMultilineText('a\rb\u2028c')).toBe('a\nb\nc');
  });

  it('is idempotent and keeps only \\n as a control character (property)', () => {
    fc.assert(
      fc.property(anyText, (raw) => {
        const once = sanitizeMultilineText(raw);
        expect(sanitizeMultilineText(once)).toBe(once);
        expect(INVISIBLE_PROBE.test(once.replace(/\n/g, ''))).toBe(false);
        expect(/\n{3,}/.test(once)).toBe(false);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('text predicates', () => {
  it('detects markup', () => {
    for (const s of ['<b>', 'a > b', '&lt;script&gt;', '&#60;', '&#x3C;', '&amp;']) expect(containsMarkup(s), s).toBe(true);
    for (const s of ['Tom & Jerry', 'R&D', 'AT&T', 'a&b;', '5 - 3', "O'Brien"]) expect(containsMarkup(s), s).toBe(false);
  });

  it('detects fullwidth angle brackets after normalization', () => {
    expect(containsMarkup(sanitizeText('＜script＞'))).toBe(true);
    expect(containsMarkup(sanitizeText('﹤b﹥'))).toBe(true);
  });

  it('detects stacked combining marks (Zalgo)', () => {
    expect(hasExcessiveCombiningMarks('e\u0301\u0302\u0303\u0304')).toBe(false);
    expect(hasExcessiveCombiningMarks('e\u0301\u0302\u0303\u0304\u0305')).toBe(true);
  });

  it('detects letters or digits in any script', () => {
    for (const s of ['a', '7', 'Ж', '名', 'ب', 'क']) expect(hasLetterOrDigit(s), s).toBe(true);
    for (const s of ['', '...', '!!!', '🙂', ' ']) expect(hasLetterOrDigit(s), s).toBe(false);
  });

  it('counts code points and UTF-8 bytes', () => {
    expect(codePointLength('a😀b')).toBe(3);
    expect('a😀b'.length).toBe(4);
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('名')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
    expect(utf8ByteLength('\uD800')).toBe(3);
  });

  it('utf8ByteLength matches TextEncoder for well-formed strings (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 50 }), (s) => {
        expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
      }),
    );
  });
});
