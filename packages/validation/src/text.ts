/**
 * Free-text sanitization (spec §7, §148). Every human-typed string that is
 * stored or shown to other people passes through `sanitizeText` (single line)
 * or `sanitizeMultilineText` (notes). The steps are fixed and documented in
 * the README; the result is idempotent: sanitizing twice changes nothing.
 */

/**
 * Line breaks and tabs: turned into a space (single line) before invisible
 * characters are removed, so "John\tSmith" stays two words.
 */
const LINE_WHITESPACE = /[\t\n\v\f\r\u0085\u2028\u2029]/g;

/**
 * Characters that are invisible or alter rendering without being visible:
 * control characters (Cc: C0, DEL, C1), format characters (Cf: soft hyphen,
 * zero-width space/joiners, LRM/RLM, bidi embeddings/overrides/isolates,
 * word joiner, BOM, interlinear annotations, tag characters), lone surrogates
 * (Cs), private-use characters (Co), every Unicode Default_Ignorable_Code_Point
 * (combining grapheme joiner, Hangul fillers, Khmer inherent vowels, Mongolian
 * and other variation selectors ...) and the Braille blank U+2800 (all often
 * used to fake empty or look-alike names).
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Default_Ignorable_Code_Point}\u2800]/gu;

/** Same as INVISIBLE but keeps "\n" (multi-line text). */
const INVISIBLE_EXCEPT_NEWLINE = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Default_Ignorable_Code_Point}\u2800]/gu;

const WHITESPACE_RUN = /\s+/gu;
const INLINE_WHITESPACE_RUN = /[^\S\n]+/gu;

/** Markup: angle brackets or an HTML character reference such as "&lt;" / "&#60;" / "&#x3c;". */
const MARKUP = /[<>]|&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;

/** A run of combining marks longer than this is rejected ("Zalgo" text that breaks layouts). */
export const MAX_COMBINING_MARK_RUN = 4;
const COMBINING_RUN = new RegExp(`\\p{M}{${MAX_COMBINING_MARK_RUN + 1},}`, 'u');

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Single-line sanitization:
 * 1. Unicode NFKC normalization (fullwidth forms, ligatures, compatibility spaces);
 * 2. tabs / line breaks → a space;
 * 3. remove invisible characters (see INVISIBLE);
 * 4. NFKC again (re-compose characters that were split by removed ones);
 * 5. collapse whitespace runs to one ASCII space; 6. trim.
 */
export function sanitizeText(raw: string): string {
  const step1 = raw.normalize('NFKC').replace(LINE_WHITESPACE, ' ');
  return step1.replace(INVISIBLE, '').normalize('NFKC').replace(WHITESPACE_RUN, ' ').trim();
}

/**
 * Multi-line sanitization (prize notes): like `sanitizeText` but keeps line
 * breaks. CRLF/CR become LF, spaces are collapsed within a line, every line is
 * trimmed, and at most one empty line is kept between paragraphs.
 */
export function sanitizeMultilineText(raw: string): string {
  const unified = raw
    .normalize('NFKC')
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n')
    .replace(/[\t\v\f]/g, ' ');
  const cleaned = unified.replace(INVISIBLE_EXCEPT_NEWLINE, '').normalize('NFKC').replace(INLINE_WHITESPACE_RUN, ' ');
  return cleaned
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when the text looks like HTML/markup (angle brackets or character references). */
export function containsMarkup(text: string): boolean {
  return MARKUP.test(text);
}

/** True when the text stacks more than MAX_COMBINING_MARK_RUN combining marks in a row. */
export function hasExcessiveCombiningMarks(text: string): boolean {
  return COMBINING_RUN.test(text);
}

/** True when the text contains at least one letter or digit (any script). */
export function hasLetterOrDigit(text: string): boolean {
  return LETTER_OR_DIGIT.test(text);
}

/** Length in Unicode code points (what a person counts as characters for most scripts). */
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** UTF-8 byte length without allocating (works in browsers and Node). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) bytes += 1;
    else if (cp < 0x800) bytes += 2;
    else if (cp < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}
