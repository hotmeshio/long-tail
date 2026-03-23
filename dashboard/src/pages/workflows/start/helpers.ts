export const DEFAULT_ENVELOPE = '{\n  "data": {},\n  "metadata": {}\n}';

/** Infer a simple field type from a value. */
export function inferTypeFromValue(value: unknown): string {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  return 'string';
}

/** Extract the data keys from an envelope_schema and their inferred types. */
export function extractDataFields(
  schema: Record<string, unknown> | null,
): { key: string; type: string; defaultValue: unknown }[] {
  if (!schema) return [];
  const data = schema.data;
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data as Record<string, unknown>).map(([key, value]) => ({
    key,
    type: inferTypeFromValue(value),
    defaultValue: value,
  }));
}

/** Build form field values from data object. */
export function dataToFields(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data };
}

/** Build full envelope JSON string from form fields + metadata. */
export function fieldsToJson(
  fields: Record<string, unknown>,
  metadata: Record<string, unknown>,
): string {
  return JSON.stringify({ data: fields, metadata }, null, 2);
}
