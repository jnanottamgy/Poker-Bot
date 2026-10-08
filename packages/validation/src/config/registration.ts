import { z } from 'zod';
import type { RegistrationFieldConfig } from '@jpb/shared-types';
import { ACCESS_CODE_PATTERN, CONFIG_LIMITS, REGISTRATION_FIELD_KEYS } from '../constants';
import { WHEN_VALID, codeSchema, displayTextSchema } from '../primitives';

export const registrationFieldKeySchema = z.enum(REGISTRATION_FIELD_KEYS);

export const registrationFieldConfigSchema = z.strictObject({
  key: registrationFieldKeySchema,
  required: z.boolean(),
  label: displayTextSchema({ max: CONFIG_LIMITS.FIELD_LABEL_MAX_LENGTH }).optional(),
});

/**
 * The display-name rule: `name` is collected even when not configured
 * (implicitly required). A config must guarantee a display name, i.e. the
 * effective `name` field is required or a required `nickname` exists.
 */
export function effectiveRegistrationFields(fields: readonly RegistrationFieldConfig[]): RegistrationFieldConfig[] {
  const out = fields.map((f) => ({ ...f }));
  if (!out.some((f) => f.key === 'name')) out.unshift({ key: 'name', required: true });
  return out;
}

export const registrationConfigSchema = z
  .strictObject({
    fields: z.array(registrationFieldConfigSchema).max(REGISTRATION_FIELD_KEYS.length),
    requireApproval: z.boolean(),
    accessCode: codeSchema(ACCESS_CODE_PATTERN, 'Use 4–32 letters, digits or "-" for the access code.').nullable(),
  })
  .superRefine((r, ctx) => {
    const firstIndex = new Map<string, number>();
    r.fields.forEach((f, i) => {
      const first = firstIndex.get(f.key);
      if (first === undefined) firstIndex.set(f.key, i);
      else {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'key'],
          message: `The field "${f.key}" is listed more than once (first at #${first + 1}).`,
        });
      }
    });
    const effective = effectiveRegistrationFields(r.fields);
    const nameRequired = effective.some((f) => f.key === 'name' && f.required);
    const nicknameRequired = effective.some((f) => f.key === 'nickname' && f.required);
    if (!nameRequired && !nicknameRequired) {
      const nameIndex = r.fields.findIndex((f) => f.key === 'name');
      ctx.addIssue({
        code: 'custom',
        path: ['fields', nameIndex, 'required'],
        message: 'Either the name or the nickname must be required so every player has a display name.',
      });
    }
  }, WHEN_VALID);
