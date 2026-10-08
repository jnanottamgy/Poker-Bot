import type { RegistrationConfig, RegistrationFieldKey } from '@jpb/shared-types';

/**
 * Registration input sanitization (spec §7, §148): collect only configured
 * fields, normalize Unicode, strip control and zero-width characters, reject
 * markup-like input, enforce formats and lengths.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

const LIMITS: Record<RegistrationFieldKey, { min: number; max: number }> = {
  name: { min: 1, max: 40 },
  nickname: { min: 1, max: 24 },
  participantId: { min: 1, max: 40 },
  email: { min: 3, max: 254 },
  phone: { min: 7, max: 20 },
  collegeId: { min: 1, max: 40 },
};

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const PHONE = /^\+?[0-9][0-9 -]{5,18}[0-9]$/;

export function cleanText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
}

export type RegistrationFields = Partial<Record<RegistrationFieldKey, string>>;

export interface FieldError {
  field: RegistrationFieldKey;
  message: string;
}

export function sanitizeRegistration(
  config: RegistrationConfig,
  input: Record<string, unknown>,
): { ok: true; fields: RegistrationFields } | { ok: false; errors: FieldError[] } {
  const fields: RegistrationFields = {};
  const errors: FieldError[] = [];
  const configured = new Map(config.fields.map((f) => [f.key, f]));
  // `name` is always collected (it is the display name at the table).
  if (!configured.has('name')) configured.set('name', { key: 'name', required: true });

  for (const [key, f] of configured) {
    let value = cleanText(input[key]);
    const limit = LIMITS[key];
    if (!value) {
      if (f.required) errors.push({ field: key, message: `${f.label ?? labelOf(key)} is required.` });
      continue;
    }
    if (/[<>]/.test(value)) {
      errors.push({ field: key, message: `${f.label ?? labelOf(key)} contains characters that are not allowed.` });
      continue;
    }
    if (key === 'email') value = value.toLowerCase();
    if (key === 'email' && !EMAIL.test(value)) errors.push({ field: key, message: 'Enter a valid email address.' });
    else if (key === 'phone' && !PHONE.test(value)) errors.push({ field: key, message: 'Enter a valid phone number.' });
    else if ([...value].length < limit.min || [...value].length > limit.max) {
      errors.push({ field: key, message: `${f.label ?? labelOf(key)} must be ${limit.min}–${limit.max} characters.` });
    } else fields[key] = value;
  }
  return errors.length ? { ok: false, errors } : { ok: true, fields };
}

function labelOf(key: RegistrationFieldKey): string {
  return { name: 'Name', nickname: 'Nickname', participantId: 'Participant ID', email: 'Email', phone: 'Phone', collegeId: 'College ID' }[key];
}

/** Display name at the table: nickname if given, else name. */
export function displayNameOf(fields: RegistrationFields): string {
  return fields.nickname || fields.name || 'Player';
}
