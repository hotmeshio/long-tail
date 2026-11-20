import { mapPayloadToForm } from './x-lt-bind';
import { isEditableListSchema, isNullableType } from './x-lt-list';

/**
 * The initial JSON an x-lt-* form edits: the schema rides along as the
 * `_form_schema` sidecar and every property starts at its prefill, its
 * declared default, or the zero value for its type. Object fields start as
 * {} so a checklist round-trips as an object from the first interaction. An
 * editable list starts empty, or as null ("not stated") when its type admits
 * null; a proposed null is kept, never turned into an empty answer.
 */
export function seedFormJson(
  formSchema: Record<string, any>,
  prefillPayload: Record<string, unknown> = {},
): string {
  const prefill = mapPayloadToForm(prefillPayload, formSchema);
  const initial: Record<string, unknown> = { _form_schema: formSchema };
  for (const [key, def] of Object.entries((formSchema.properties ?? {}) as Record<string, Record<string, any>>)) {
    const proposed = prefill[key];
    initial[key] = proposed !== undefined && (proposed !== null || isNullableType(def))
      ? proposed
      : def.default ?? zeroValue(def);
  }
  return JSON.stringify(initial, null, 2);
}

function zeroValue(def: Record<string, any>): unknown {
  if (def.type === 'object') return {};
  if (isEditableListSchema(def)) return isNullableType(def) ? null : [];
  return '';
}
