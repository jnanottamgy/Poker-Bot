import type { RegistrationFieldConfig, RegistrationFieldKey } from '@jpb/shared-types';

export interface FieldMeta {
  label: string;
  type: 'text' | 'email' | 'tel';
  autoComplete: string;
  inputMode?: 'text' | 'email' | 'tel' | 'numeric';
  hint?: string;
  maxLength: number;
}

/** Presentation of each field the organiser may request (config decides which ones). */
export const FIELD_META: Readonly<Record<RegistrationFieldKey, FieldMeta>> = {
  name: { label: 'Full name', type: 'text', autoComplete: 'name', maxLength: 60, hint: 'As on your ticket or ID. Only staff see it.' },
  nickname: { label: 'Nickname', type: 'text', autoComplete: 'nickname', maxLength: 20, hint: 'Shown to other players at the table.' },
  participantId: { label: 'Participant ID', type: 'text', autoComplete: 'off', maxLength: 32 },
  email: { label: 'Email', type: 'email', autoComplete: 'email', inputMode: 'email', maxLength: 120 },
  phone: { label: 'Phone', type: 'tel', autoComplete: 'tel', inputMode: 'tel', maxLength: 20 },
  collegeId: { label: 'College ID', type: 'text', autoComplete: 'off', maxLength: 32 },
};

export function fieldLabel(f: RegistrationFieldConfig): string {
  return f.label?.trim() || FIELD_META[f.key].label;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NICKNAME = /^[\p{L}\p{N} ._'-]+$/u;

function checkValue(key: RegistrationFieldKey, value: string): string | null {
  const meta = FIELD_META[key];
  if (value.length > meta.maxLength) return `Use at most ${meta.maxLength} characters.`;
  switch (key) {
    case 'name':
      return value.length < 2 ? 'Enter your full name.' : null;
    case 'nickname':
      if (value.length < 2) return 'Use at least 2 characters.';
      return NICKNAME.test(value) ? null : 'Letters, numbers, spaces and . _ - only.';
    case 'email':
      return EMAIL.test(value) ? null : 'Enter a valid email, like name@example.com.';
    case 'phone': {
      if (!/^\+?[\d\s()-]+$/.test(value)) return 'Use digits only (a leading + is fine).';
      const digits = value.replace(/\D/g, '').length;
      return digits >= 7 && digits <= 15 ? null : 'Enter a phone number with 7 to 15 digits.';
    }
    default:
      return null;
  }
}

/**
 * Client-side validation for a friendlier form. The server validates again
 * and its answer wins.
 */
export function validateRegistration(
  fields: readonly RegistrationFieldConfig[],
  values: Readonly<Record<string, string>>,
  access: { required: boolean; code: string },
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? '').trim();
    if (!v) {
      if (f.required) errors[f.key] = `${fieldLabel(f)} is required.`;
      continue;
    }
    const problem = checkValue(f.key, v);
    if (problem) errors[f.key] = problem;
  }
  if (access.required && !access.code.trim()) errors.accessCode = 'Enter the access code shown at the venue.';
  return errors;
}

/** Data minimisation: send only configured fields, trimmed, and only when filled in. */
export function cleanRegistration(fields: readonly RegistrationFieldConfig[], values: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? '').trim().replace(/\s+/g, ' ');
    if (v) out[f.key] = v;
  }
  return out;
}
