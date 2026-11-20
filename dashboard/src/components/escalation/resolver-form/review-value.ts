import { resolveFieldOptions } from '../../../lib/x-lt-options';
import { deriveFieldLabel } from '../../../lib/derive-field-label';
import { isListSchema, itemColumnOrder, itemSchemaOf, readListSpec } from '../../../lib/x-lt-list';

const EMPTY = 'empty';
const NOT_STATED = 'Not stated';
const NONE = 'None';
const MAX_CHARS = 120;

type Schema = Record<string, unknown>;
const clip = (text: string) => (text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function scalarText(value: unknown, source: Schema | undefined, ctx: Record<string, unknown> | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const option = resolveFieldOptions(source, ctx)?.find((o) => String(o.value) === String(value));
  return option ? String(option.label) : String(value);
}

/** One list item as a short phrase: option label, the item title, or labeled cells. */
function itemText(item: unknown, fieldSchema: Schema, ctx: Record<string, unknown> | undefined): string {
  if (!isRecord(item)) return scalarText(item, itemSchemaOf(fieldSchema)?.['x-lt-options'] ? itemSchemaOf(fieldSchema) : fieldSchema, ctx);
  const items = itemSchemaOf(fieldSchema);
  const title = readListSpec(fieldSchema).itemTitle;
  if (title && typeof item[title] === 'string') return item[title] as string;
  const properties = (items?.properties ?? {}) as Record<string, Schema>;
  const keys = Object.keys(properties).length > 0 ? itemColumnOrder(items) : Object.keys(item);
  const parts = keys
    .filter((k) => item[k] !== undefined && item[k] !== null && item[k] !== '')
    .map((k) => `${deriveFieldLabel(k, properties[k])} ${scalarText(item[k], properties[k], ctx)}`);
  return parts.length > 0 ? parts.join(', ') : EMPTY;
}

/** A proposal or answer as one short line: the option label when there is one, never raw JSON walls. */
export function formatReviewValue(
  value: unknown,
  fieldSchema: Schema | undefined,
  ctx: Record<string, unknown> | undefined,
): string {
  const list = isListSchema(fieldSchema);
  if (list && value === null) return NOT_STATED;
  if (value === null || value === undefined || value === '') return EMPTY;
  if (Array.isArray(value)) {
    if (value.length === 0) return list ? NONE : EMPTY;
    return clip(value.map((v) => itemText(v, fieldSchema ?? {}, ctx)).join(list ? '; ' : ', '));
  }
  if (typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return clip(scalarText(value, fieldSchema, ctx));
  return clip(JSON.stringify(value));
}
