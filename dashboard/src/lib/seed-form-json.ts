import { mapPayloadToForm } from './x-lt-bind';

/**
 * The initial JSON an x-lt-* form edits: the schema rides along as the
 * `_form_schema` sidecar and every property starts at its prefill, its
 * declared default, or the zero value for its type. Object fields start as
 * {} so a checklist round-trips as an object from the first interaction.
 */
export function seedFormJson(
  formSchema: Record<string, any>,
  prefillPayload: Record<string, unknown> = {},
): string {
  const prefill = mapPayloadToForm(prefillPayload, formSchema);
  const initial: Record<string, unknown> = { _form_schema: formSchema };
  for (const [key, def] of Object.entries((formSchema.properties ?? {}) as Record<string, Record<string, any>>)) {
    const zero = def.type === 'object' ? {} : '';
    initial[key] = prefill[key] ?? def.default ?? zero;
  }
  return JSON.stringify(initial, null, 2);
}
