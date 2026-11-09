import { resolveFieldOptions } from '../../../lib/x-lt-options';

const EMPTY = 'empty';
const MAX_CHARS = 120;

/** A proposal or answer as one short line: the option label when there is one, never raw JSON walls. */
export function formatReviewValue(
  value: unknown,
  fieldSchema: Record<string, unknown> | undefined,
  ctx: Record<string, unknown> | undefined,
): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') {
    const option = resolveFieldOptions(fieldSchema, ctx)?.find((o) => String(o.value) === String(value));
    const text = option ? String(option.label) : String(value);
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;
  }
  if (Array.isArray(value)) return value.length === 0 ? EMPTY : value.map((v) => formatReviewValue(v, undefined, ctx)).join(', ');
  const json = JSON.stringify(value);
  return json.length > MAX_CHARS ? `${json.slice(0, MAX_CHARS - 1)}…` : json;
}
