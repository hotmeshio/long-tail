/**
 * Rows of a list-of-objects field. A row left with no value in any declared
 * property is an untouched row, dropped when the answer is submitted; an
 * undeclared property never makes a row non-empty.
 */
import { itemSchemaOf, singleType } from './x-lt-list';

type Schema = Record<string, any>;
type Json = unknown;

const isBlank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** A row with no value in any declared property. Undeclared properties do not make a row non-empty. */
export function isEmptyRow(row: Json, itemSchema: Schema | undefined): boolean {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return isBlank(row);
  const names = Object.keys((itemSchema?.properties ?? {}) as Schema);
  const keys = names.length > 0 ? names : Object.keys(row);
  return keys.every((k) => isBlank((row as Record<string, unknown>)[k]));
}

/** Rows left entirely empty are dropped when the answer is submitted. */
export function dropEmptyRows(value: Json, fieldSchema: Schema | undefined): Json {
  if (!Array.isArray(value)) return value;
  const items = itemSchemaOf(fieldSchema);
  if (singleType(items) !== 'object' && !items?.properties) return value;
  return value.filter((row) => !isEmptyRow(row, items));
}


/** The form values with every rows field stripped of its empty rows. */
export function dropEmptyRowsInForm<T extends Record<string, unknown>>(values: T, formSchema: Schema | undefined): T {
  const properties = (formSchema?.properties ?? {}) as Record<string, Schema>;
  const next: Record<string, unknown> = { ...values };
  for (const [key, def] of Object.entries(properties)) {
    if (Array.isArray(next[key])) next[key] = dropEmptyRows(next[key], def);
  }
  return next as T;
}
