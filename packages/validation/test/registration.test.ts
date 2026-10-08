import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RegistrationConfig } from '@jpb/shared-types';
import {
  REGISTRATION_FIELD_LIMITS,
  manualRegistrationSchema,
  normalizeRegistrationValue,
  registrationDisplayName,
  registrationFieldsSchema,
  registrationRequestSchema,
  validateRegistration,
  validateWith,
} from '../src';
import { expectIssue, expectOk } from './fixtures';

const ALL_FIELDS: RegistrationConfig = {
  fields: [
    { key: 'name', required: true },
    { key: 'nickname', required: false },
    { key: 'participantId', required: false, label: 'Roll number' },
    { key: 'email', required: false },
    { key: 'phone', required: false },
    { key: 'collegeId', required: false },
  ],
  requireApproval: false,
  accessCode: null,
};

const NAME_ONLY: RegistrationConfig = { fields: [{ key: 'name', required: true }], requireApproval: false, accessCode: null };

function register(fields: Record<string, unknown>, config: RegistrationConfig = ALL_FIELDS, extra: Record<string, unknown> = {}) {
  return validateRegistration(config, { fields, ...extra });
}

describe('registration: names', () => {
  it('trims, collapses and normalizes', () => {
    expect(expectOk(register({ name: '   Priya    Sharma  ' })).fields.name).toBe('Priya Sharma');
    expect(expectOk(register({ name: 'Ｐｒｉｙａ' })).fields.name).toBe('Priya');
  });

  it('strips control and zero-width characters', () => {
    expect(expectOk(register({ name: 'Pri\u200Bya\u0000 \u202ESharma\uFEFF' })).fields.name).toBe('Priya Sharma');
    expect(expectOk(register({ name: 'A\u200Dlex' })).fields.name).toBe('Alex');
  });

  it('accepts names in any script, apostrophes and hyphens', () => {
    for (const name of ["O'Brien", 'Jean-Luc', 'Zoë', 'Ølstad', 'Иван', '李小龍', 'محمد', 'द\u0947वन\u093Eगर\u0940', 'Nguyễn Văn A']) {
      expect(expectOk(register({ name })).fields.name, name).toBe(name.normalize('NFKC'));
    }
  });

  it('rejects HTML-like input', () => {
    for (const name of ['<script>alert(1)</script>', 'Bob <b>', 'a>b', '&lt;b&gt;', '&#60;img&#62;', '＜script＞']) {
      expectIssue(register({ name }), 'fields.name', 'HTML');
    }
  });

  it('rejects names that are empty after sanitization', () => {
    for (const name of ['', '   ', '\u200B\u200B', '\u3164', '\u2800', '\u0000\t\n']) {
      expectIssue(register({ name }), 'fields.name', 'required');
    }
  });

  it('rejects names without a letter or digit', () => {
    expectIssue(register({ name: '...' }), 'fields.name', 'letter or digit');
    expectIssue(register({ name: '🙂🙂' }), 'fields.name', 'letter or digit');
  });

  it('enforces length limits in code points after sanitization', () => {
    const max = REGISTRATION_FIELD_LIMITS.name.max;
    expect(expectOk(register({ name: 'a'.repeat(max) })).fields.name).toHaveLength(max);
    expectIssue(register({ name: 'a'.repeat(max + 1) }), 'fields.name', `1–${max}`);
    // zero-width padding does not count
    expect(expectOk(register({ name: `${'a'.repeat(max)}${'\u200B'.repeat(50)}` })).fields.name).toHaveLength(max);
    // astral characters count once
    expect(expectOk(register({ name: `A${'😀'.repeat(max - 1)}` })).fields.name).toBeDefined();
    expectIssue(register({ name: 'x'.repeat(5000) }), 'fields.name', 'too long');
  });

  it('rejects stacked combining marks', () => {
    // NFKC first composes a + U+0300 into one letter; six marks remain stacked.
    expectIssue(register({ name: 'Za\u0300\u0301\u0302\u0303\u0304\u0305\u0306lgo' }), 'fields.name', 'accent');
    expect(register({ name: 'Za\u0300\u0301\u0302\u0303\u0304lgo' }).ok).toBe(true);
  });

  it('rejects non-string values', () => {
    for (const name of [42, true, ['Bob'], { first: 'Bob' }]) expectIssue(register({ name }), 'fields.name', 'must be text');
  });

  it('requires name by default, even when not configured', () => {
    expectIssue(register({}), 'fields.name', 'Name is required');
    expectIssue(validateRegistration({ fields: [{ key: 'email', required: false }], requireApproval: false, accessCode: null }, { fields: {} }), 'fields.name');
    expectIssue(validateRegistration(NAME_ONLY, {}), 'fields.name');
    expectIssue(register({ name: null }), 'fields.name', 'required');
  });

  it('allows an optional name when the config says so', () => {
    const cfg: RegistrationConfig = { fields: [{ key: 'name', required: false }, { key: 'nickname', required: true }], requireApproval: false, accessCode: null };
    expect(expectOk(validateRegistration(cfg, { fields: { nickname: 'Ace' } })).fields).toEqual({ nickname: 'Ace' });
  });
});

describe('registration: other fields', () => {
  it('normalizes email to lowercase and validates the format', () => {
    expect(expectOk(register({ name: 'A', email: '  Priya.Sharma+poker@Example.ORG ' })).fields.email).toBe('priya.sharma+poker@example.org');
    for (const email of ['not-an-email', 'a@b', '@example.com', 'a@@example.com', 'a b@example.com', 'a@example.c']) {
      expectIssue(register({ name: 'A', email }), 'fields.email', 'valid email');
    }
    expectIssue(register({ name: 'A', email: '<a@example.com>' }), 'fields.email');
  });

  it('normalizes phone numbers and validates digit counts', () => {
    expect(expectOk(register({ name: 'A', phone: '+91 98765-43210' })).fields.phone).toBe('+919876543210');
    expect(expectOk(register({ name: 'A', phone: '(022) 2345.6789' })).fields.phone).toBe('02223456789');
    for (const phone of ['12345', '+1234567890123456', 'call me', '+91 98765 4321x', '++919876543210']) {
      expectIssue(register({ name: 'A', phone }), 'fields.phone', 'phone');
    }
  });

  it('validates ids and uses the configured label in messages', () => {
    expect(expectOk(register({ name: 'A', participantId: ' 2021/CS-045 ' })).fields.participantId).toBe('2021/CS-045');
    expectIssue(register({ name: 'A', participantId: '#45' }), 'fields.participantId', 'Roll number');
    expectIssue(register({ name: 'A', collegeId: 'ID;DROP' }), 'fields.collegeId', 'College ID');
  });

  it('treats empty optional fields as absent', () => {
    const value = expectOk(register({ name: 'A', nickname: '  ', email: '', phone: null }));
    expect(value.fields).toEqual({ name: 'A' });
    expect(Object.keys(value.fields)).toEqual(['name']);
  });

  it('enforces required optional-by-default fields when configured required', () => {
    const cfg: RegistrationConfig = { fields: [{ key: 'name', required: true }, { key: 'email', required: true, label: 'College email' }], requireApproval: false, accessCode: null };
    expectIssue(validateRegistration(cfg, { fields: { name: 'A' } }), 'fields.email', 'College email is required');
  });

  it('drops fields that are not configured', () => {
    const value = expectOk(validateRegistration(NAME_ONLY, { fields: { name: 'A', email: 'x@example.com', isAdmin: true, __proto__: { a: 1 } } }));
    expect(value.fields).toEqual({ name: 'A' });
  });

  it('display name prefers the nickname', () => {
    expect(registrationDisplayName({ name: 'Priya', nickname: 'Ace' })).toBe('Ace');
    expect(registrationDisplayName({ name: 'Priya' })).toBe('Priya');
    expect(registrationDisplayName({})).toBeNull();
  });
});

describe('registration: access code and client seed', () => {
  it('normalizes a valid client seed to lowercase', () => {
    const seed = 'ABCDEF0123456789'.repeat(4);
    expect(expectOk(register({ name: 'A' }, ALL_FIELDS, { clientSeed: ` ${seed} ` })).clientSeed).toBe(seed.toLowerCase());
  });

  it('accepts 32..128 hex characters and treats empty/null as absent', () => {
    expect(expectOk(register({ name: 'A' }, ALL_FIELDS, { clientSeed: 'a'.repeat(32) })).clientSeed).toBe('a'.repeat(32));
    expect(expectOk(register({ name: 'A' }, ALL_FIELDS, { clientSeed: 'f'.repeat(128) })).clientSeed).toHaveLength(128);
    expect(expectOk(register({ name: 'A' }, ALL_FIELDS, { clientSeed: '' })).clientSeed).toBeNull();
    expect(expectOk(register({ name: 'A' }, ALL_FIELDS, { clientSeed: null })).clientSeed).toBeNull();
    expect(expectOk(register({ name: 'A' })).clientSeed).toBeNull();
  });

  it('rejects malformed client seeds', () => {
    for (const clientSeed of ['a'.repeat(31), 'a'.repeat(129), 'g'.repeat(64), '0x' + 'a'.repeat(62), 'a'.repeat(5000), 12345]) {
      expectIssue(register({ name: 'A' }, ALL_FIELDS, { clientSeed }), 'clientSeed');
    }
  });

  it('requires the access code when the tournament has one', () => {
    const cfg: RegistrationConfig = { ...NAME_ONLY, accessCode: 'VENUE-7' };
    expectIssue(validateRegistration(cfg, { fields: { name: 'A' } }), 'accessCode', 'access code');
    expect(expectOk(validateRegistration(cfg, { fields: { name: 'A' }, accessCode: ' venue-7 ' })).accessCode).toBe('VENUE-7');
    // staff registrations skip it
    expect(validateRegistration(cfg, { fields: { name: 'A' } }, { requireAccessCode: false }).ok).toBe(true);
  });

  it('rejects unknown top-level keys', () => {
    expectIssue(register({ name: 'A' }, ALL_FIELDS, { role: 'ADMIN' }), '', 'Unknown field');
  });

  it('rejects non-object bodies', () => {
    for (const body of [null, 'name=A', [], 42]) expect(validateRegistration(NAME_ONLY, body).ok).toBe(false);
    expectIssue(validateRegistration(NAME_ONLY, { fields: 'A' }), 'fields');
  });
});

describe('registration: helpers and properties', () => {
  it('manual staff registration takes fields only', () => {
    expect(manualRegistrationSchema(NAME_ONLY).safeParse({ fields: { name: 'Walk-in' } }).success).toBe(true);
    expect(manualRegistrationSchema(NAME_ONLY).safeParse({ fields: { name: 'Walk-in' }, clientSeed: 'a'.repeat(32) }).success).toBe(false);
  });

  it('normalizeRegistrationValue is usable on its own', () => {
    expect(normalizeRegistrationValue('email', 'A@B.CO', 'Email')).toEqual({ ok: true, value: 'a@b.co' });
    expect(normalizeRegistrationValue('nickname', '<x>', 'Nickname').ok).toBe(false);
  });

  it('accepted values are sanitized, within limits and stable under re-validation (property)', () => {
    const text = fc.oneof(fc.string({ unit: 'binary', maxLength: 60 }), fc.string({ unit: 'grapheme', maxLength: 30 }));
    const schema = registrationRequestSchema(ALL_FIELDS); // built once, as a server would per tournament
    fc.assert(
      fc.property(fc.record({ name: text, nickname: text, participantId: text, email: text, phone: text, collegeId: text }), (fields) => {
        const result = validateWith(schema, { fields });
        if (!result.ok) {
          expect(result.error.issues.length).toBeGreaterThan(0);
          return;
        }
        for (const [key, value] of Object.entries(result.value.fields)) {
          const limits = REGISTRATION_FIELD_LIMITS[key as keyof typeof REGISTRATION_FIELD_LIMITS];
          expect([...value].length).toBeGreaterThanOrEqual(limits.min);
          expect([...value].length).toBeLessThanOrEqual(limits.max);
          expect(/[<>\p{Cc}\p{Cf}]/u.test(value)).toBe(false);
        }
        const again = validateWith(schema, { fields: result.value.fields });
        expect(again.ok && again.value.fields).toEqual(result.value.fields);
      }),
      { numRuns: 1000 },
    );
  });

  it('the fields schema never throws on arbitrary input (property)', () => {
    const schema = registrationFieldsSchema(ALL_FIELDS);
    fc.assert(fc.property(fc.anything(), (input) => void schema.safeParse(input)));
    const request = registrationRequestSchema(ALL_FIELDS);
    fc.assert(fc.property(fc.anything(), (input) => void validateWith(request, input)));
  });
});
