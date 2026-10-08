import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { failure, formatPath, formatZodError, friendlyErrorMap, humanizePath, intInRange, validateWith } from '../src';

describe('formatZodError', () => {
  it('turns issues into path + friendly message + labelled text', () => {
    const schema = z.strictObject({ blindSchedule: z.array(z.strictObject({ bigBlind: intInRange(1) })) });
    const result = schema.safeParse({ blindSchedule: [{ bigBlind: 1 }, { bigBlind: 0 }] }, { error: friendlyErrorMap });
    expect(result.success).toBe(false);
    if (result.success) return;
    const formatted = formatZodError(result.error);
    expect(formatted.issues).toEqual([
      {
        path: 'blindSchedule[1].bigBlind',
        segments: ['blindSchedule', 1, 'bigBlind'],
        code: 'too_small',
        message: 'Must be at least 1.',
        text: 'Blind schedule › #2 › Big blind: Must be at least 1.',
      },
    ]);
    expect(formatted.message).toBe('Blind schedule › #2 › Big blind: Must be at least 1.');
  });

  it('summarizes multiple problems', () => {
    const result = validateWith(z.strictObject({ a: z.string(), b: z.number(), c: z.boolean() }), {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues).toHaveLength(3);
      expect(result.error.message).toBe('A: This field is required. (and 2 more problems)');
    }
  });

  it('never leaks exception text or stack traces for non-Zod errors', () => {
    const err = new Error('SELECT * FROM secrets failed at /srv/app.js:12');
    expect(formatZodError(err)).toEqual({ message: 'The input could not be validated.', issues: [] });
    expect(formatZodError('boom')).toEqual({ message: 'The input could not be validated.', issues: [] });
    expect(formatZodError(undefined).issues).toEqual([]);
  });

  it('does not echo input values in messages', () => {
    const secret = 'hunter2-super-secret';
    const result = validateWith(z.strictObject({ pin: z.number(), mode: z.enum(['A', 'B']) }), { pin: secret, mode: secret, [secret]: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const all = JSON.stringify(result.error.issues.map((i) => i.message));
      expect(all).not.toContain('hunter2-super-secret"');
      expect(result.error.issues.find((i) => i.path === 'pin')?.message).toBe('Must be a number.');
      expect(result.error.issues.find((i) => i.path === 'mode')?.message).toBe('Must be one of: "A", "B".');
    }
  });

  it('truncates and sanitizes unknown key names', () => {
    const result = validateWith(z.strictObject({}), { ['k'.repeat(100)]: 1, 'bad\u0000key': 2, a: 1, b: 1, c: 1, d: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = result.error.issues[0]!.message;
      expect(msg).toContain('…');
      expect(msg).toContain('bad?key');
      expect(msg).toContain('and 1 more');
      expect(msg.length).toBeLessThan(300);
    }
  });
});

describe('friendly messages', () => {
  const cases: Array<[string, z.ZodType, unknown, string]> = [
    ['missing', z.object({ a: z.string() }), {}, 'This field is required.'],
    ['wrong type', z.number(), 'x', 'Must be a number.'],
    ['NaN', z.number(), Number.NaN, 'Must be a finite number.'],
    ['Infinity', z.number(), Number.POSITIVE_INFINITY, 'Must be a finite number.'],
    ['whole number', intInRange(0), 1.5, 'Must be a whole number.'],
    ['unsafe integer', intInRange(0), 2 ** 53, 'Must be at most 9,007,199,254,740,991.'],
    ['boolean', z.boolean(), 'true', 'Must be true or false.'],
    ['array', z.array(z.number()), {}, 'Must be a list.'],
    ['empty string', z.string().min(1), '', 'Must not be empty.'],
    ['short string', z.string().min(3), 'ab', 'Must be at least 3 characters.'],
    ['long string', z.string().max(2), 'abc', 'Must be at most 2 characters.'],
    ['empty array', z.array(z.number()).min(1), [], 'Must contain at least one item.'],
    ['long array', z.array(z.number()).max(1), [1, 2], 'Must contain at most 1 items.'],
    ['exclusive min', z.number().gt(0), 0, 'Must be greater than 0.'],
    ['email', z.email(), 'x', 'Must be a valid email address.'],
    ['regex', z.string().regex(/^a$/), 'b', 'Has an invalid format.'],
    ['literal', z.literal('NLH'), 'PLO', 'Must be "NLH".'],
    ['multiple of', z.number().multipleOf(5), 7, 'Must be a multiple of 5.'],
    ['union', z.union([z.number(), z.boolean()]), 'x', 'Does not match any allowed form.'],
    ['discriminator', z.discriminatedUnion('t', [z.object({ t: z.literal('a') })]), { t: 'b' }, 'Unknown or missing type.'],
    ['custom', z.number().refine((n) => n > 5), 1, 'Is invalid.'],
  ];
  it.each(cases)('%s', (_name, schema, input, message) => {
    const result = validateWith(schema, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues[0]!.message).toBe(message);
  });

  it('schema-level messages win over the friendly defaults', () => {
    const result = validateWith(z.string().min(3, { error: 'Too short, sorry.' }), 'a');
    expect(!result.ok && result.error.issues[0]!.message).toBe('Too short, sorry.');
  });
});

describe('paths', () => {
  it('formats dotted paths with indices and quoted odd keys', () => {
    expect(formatPath([])).toBe('');
    expect(formatPath(['a', 0, 'b'])).toBe('a[0].b');
    expect(formatPath(['fields', 'my key'])).toBe('fields["my key"]');
    expect(formatPath([3])).toBe('[3]');
  });

  it('humanizes camelCase keys and 1-based indices', () => {
    expect(humanizePath(['prizeStructure', 'places', 0, 'amountMinor'])).toBe('Prize structure › Places › #1 › Amount minor');
    expect(humanizePath(['timing', 'actionGraceMs'])).toBe('Timing › Action grace ms');
    expect(humanizePath([])).toBe('');
  });

  it('failure() builds results for checks outside Zod', () => {
    const r = failure([{ segments: ['timing', 'actionTimerSeconds'], message: 'Locked.' }]);
    expect(r).toEqual({
      ok: false,
      error: {
        message: 'Timing › Action timer seconds: Locked.',
        issues: [{ path: 'timing.actionTimerSeconds', segments: ['timing', 'actionTimerSeconds'], code: 'custom', message: 'Locked.', text: 'Timing › Action timer seconds: Locked.' }],
      },
    });
  });
});
