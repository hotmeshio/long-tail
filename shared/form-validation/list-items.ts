/**
 * Item-level validation of a list field: every entry against `items`. Scalar
 * entries run the same checks a top-level field runs; object entries (rows)
 * check each declared property, `required`, and `additionalProperties`. Each
 * error names its item with a message the form shows and a JSON pointer
 * relative to the list (`/1/quantity`), so a 422 and the form say the same
 * thing about the same cell.
 *
 * A cell's `x-lt-options` and `x-lt-showIf` read the row it sits in through
 * the `row` domain (`row.hcpcs`), beside the form-level domains.
 */
import { deriveFieldLabel } from './derive-field-label';
import { comparableAnswer } from './x-lt-confidence';
import { validateFieldConstraints, validateFieldType } from './field-validator';
import { evaluateShowIf, type ShowIfContext } from './x-lt-show-if';
import { isListSchema, isObjectItems, itemSchemaOf } from './x-lt-list';

type Schema = Record<string, unknown>;

export interface ListItemError {
  index: number;
  /** The property name when the error belongs to one cell of a row. */
  cell?: string;
  message: string;
  /** JSON pointer relative to the list: `/1` or `/1/quantity`. */
  pointer: string;
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function withRow(ctx: Record<string, unknown> | undefined, row: Record<string, unknown>): Record<string, unknown> {
  return { ...(ctx ?? {}), row };
}

/** One cell's error: type first, then constraints, then a nested list's own items. */
function cellError(
  value: unknown,
  cellSchema: Schema,
  ctx: Record<string, unknown>,
): string | undefined {
  const own = validateFieldType(value, cellSchema) ?? validateFieldConstraints(value, cellSchema, ctx);
  if (own) return own;
  if (Array.isArray(value) && isListSchema(cellSchema)) {
    const nested = validateListItems(value, cellSchema, ctx)[0];
    if (nested) return nested.message;
  }
  return undefined;
}

function rowErrors(
  row: Record<string, unknown>,
  index: number,
  items: Schema,
  ctx: Record<string, unknown> | undefined,
): ListItemError[] {
  const errors: ListItemError[] = [];
  const rowCtx = withRow(ctx, row);
  const properties = (isRecord(items.properties) ? items.properties : {}) as Record<string, Schema>;
  const required = new Set(Array.isArray(items.required) ? (items.required as string[]) : []);
  const prefix = `Row ${index + 1}`;
  for (const [name, cellSchema] of Object.entries(properties)) {
    if (!evaluateShowIf(cellSchema['x-lt-showIf'], rowCtx as ShowIfContext)) continue;
    const label = deriveFieldLabel(name, cellSchema);
    const value = row[name];
    const message = required.has(name) && isBlank(value) ? 'Required' : cellError(value, cellSchema, rowCtx);
    if (message) errors.push({ index, cell: name, message: `${prefix}, ${label}: ${message}`, pointer: `/${index}/${name}` });
  }
  if (items.additionalProperties === false) {
    const unknown = Object.keys(row).filter((k) => !(k in properties));
    for (const key of unknown) {
      errors.push({ index, cell: key, message: `${prefix}: Unknown field "${key}"`, pointer: `/${index}/${key}` });
    }
  }
  return errors;
}

function duplicateErrors(value: unknown[], noun: string): ListItemError[] {
  const seen = new Set<string>();
  const errors: ListItemError[] = [];
  value.forEach((entry, index) => {
    const key = comparableAnswer(entry);
    if (seen.has(key)) errors.push({ index, message: `${noun} ${index + 1}: Duplicate value`, pointer: `/${index}` });
    seen.add(key);
  });
  return errors;
}

/** Every item error of a list, in item order. An empty list has none; presence is the required check's job. */
export function validateListItems(
  value: unknown[],
  fieldSchema: Schema,
  ctx: Record<string, unknown> | undefined,
): ListItemError[] {
  const items = itemSchemaOf(fieldSchema);
  const asRows = isObjectItems(items);
  const errors: ListItemError[] = [];
  if (items) {
    value.forEach((entry, index) => {
      if (asRows && isRecord(entry)) {
        errors.push(...rowErrors(entry, index, items, ctx));
        return;
      }
      const message = validateFieldType(entry, items) ?? validateFieldConstraints(entry, items, ctx);
      if (message) errors.push({ index, message: `Item ${index + 1}: ${message}`, pointer: `/${index}` });
    });
  }
  if (fieldSchema.uniqueItems === true) errors.push(...duplicateErrors(value, asRows ? 'Row' : 'Item'));
  return errors.sort((a, b) => a.index - b.index);
}
