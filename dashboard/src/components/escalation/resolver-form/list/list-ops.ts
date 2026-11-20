/**
 * Pure operations on a list field's value, shared by every list control. A
 * list value is an array, or null when the schema's type admits null and the
 * answer is "not stated". Nothing here mutates its input.
 */
import { comparableAnswer } from '../../../../lib/x-lt-confidence';
import {
  applyTransforms,
  itemSchemaOf,
  readTransforms,
  singleType,
} from '../../../../lib/x-lt-list';
import type { JsonValue } from '../form-cells';
import { dropEmptyRows, isEmptyRow } from '../../../../lib/list-rows';

export { dropEmptyRows, isEmptyRow };

type Schema = Record<string, any>;

export const asItems = (value: unknown): JsonValue[] => (Array.isArray(value) ? (value as JsonValue[]) : []);

export function appendItem(value: unknown, item: JsonValue): JsonValue[] {
  return [...asItems(value), item];
}

export function replaceAt(value: unknown, index: number, item: JsonValue): JsonValue[] {
  return asItems(value).map((v, i) => (i === index ? item : v));
}

export function removeAt(value: unknown, index: number): JsonValue[] {
  return asItems(value).filter((_, i) => i !== index);
}

export function duplicateAt(value: unknown, index: number): JsonValue[] {
  const items = asItems(value);
  if (index < 0 || index >= items.length) return items;
  const copy = JSON.parse(JSON.stringify(items[index])) as JsonValue;
  return [...items.slice(0, index + 1), copy, ...items.slice(index + 1)];
}

/** Move one item by `delta` places; out-of-range moves leave the list unchanged. */
export function moveItem(value: unknown, index: number, delta: number): JsonValue[] {
  const items = [...asItems(value)];
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return items;
  const [moved] = items.splice(index, 1);
  items.splice(to, 0, moved);
  return items;
}

/** A new row seeded from each property's `default`; properties without one stay absent. */
export function newRow(itemSchema: Schema | undefined): JsonValue {
  const row: Record<string, JsonValue> = {};
  for (const [name, cell] of Object.entries((itemSchema?.properties ?? {}) as Record<string, Schema>)) {
    if (cell && cell.default !== undefined) row[name] = cell.default as JsonValue;
  }
  return row;
}

/** Pills commit text through the item's transforms and type: numeric items submit numbers. */
export function pillValue(text: string, fieldSchema: Schema | undefined): JsonValue {
  const items = itemSchemaOf(fieldSchema);
  const cleaned = applyTransforms(text, readTransforms(items));
  const type = singleType(items);
  if ((type === 'number' || type === 'integer') && cleaned !== '' && Number.isFinite(Number(cleaned))) return Number(cleaned);
  return cleaned;
}

/** Split pasted text into pill candidates: commas, semicolons, tabs and new lines separate. */
export function splitPaste(text: string): string[] {
  return text.split(/[,;\t\r\n]+/).map((t) => t.trim()).filter((t) => t.length > 0);
}

/** The index of an equal value already in the list, or -1. */
export function indexOfEqual(value: unknown, candidate: JsonValue): number {
  const wanted = comparableAnswer(candidate);
  return asItems(value).findIndex((v) => comparableAnswer(v) === wanted);
}

/** Word-form label for an item key: `source_section` reads "Source section". */
export function keyWords(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[_\-\s]+/).filter(Boolean).join(' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function coerceCell(text: string, cell: Schema | undefined): JsonValue {
  const type = singleType(cell);
  if ((type === 'number' || type === 'integer') && text !== '' && Number.isFinite(Number(text))) return Number(text);
  if (type === 'boolean') return /^(true|yes|y|1)$/i.test(text);
  return text;
}

/**
 * Tab-separated text (a spreadsheet selection) written into rows from the
 * focused cell onward. Lines past the end add rows, up to `maxRows`.
 */
export function pasteGrid(
  value: unknown,
  start: { row: number; col: number },
  text: string,
  columns: string[],
  itemSchema: Schema | undefined,
  maxRows?: number,
): JsonValue[] {
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));
  const rows = asItems(value).map((r) => ({ ...(r as Record<string, JsonValue>) }));
  lines.forEach((cells, dy) => {
    const at = start.row + dy;
    if (maxRows !== undefined && at >= maxRows) return;
    while (rows.length <= at) rows.push(newRow(itemSchema) as Record<string, JsonValue>);
    cells.forEach((cell, dx) => {
      const name = columns[start.col + dx];
      if (name) rows[at][name] = coerceCell(cell.trim(), (itemSchema?.properties as Record<string, Schema> | undefined)?.[name]);
    });
  });
  return rows;
}
