/**
 * The vocabulary of list fields: which control a list gets and the tokens that
 * shape it. A list is a JSON Schema `array`, possibly nullable
 * (`type: ["array", "null"]`), whose `items` describe one entry: a scalar
 * (pills), an object (rows), or a closed option set (chips or a picker).
 * Pure reads of the schema; the dashboard renders from them and the server
 * validates against them, so both sides agree on what a list is.
 */
import { readScanSink } from './x-lt-scan';
import { X_LT_OPTIONS } from './x-lt-options';

type Schema = Record<string, unknown>;

export const X_LT_WIDGET = 'x-lt-widget';
export const LIST_WIDGETS = { PILLS: 'pills', ROWS: 'rows', JSON: 'json' } as const;
export const X_LT_ITEM_LAYOUTS = { EVIDENCE: 'evidence', CARD: 'card', TABLE: 'table' } as const;
export const X_LT_TRANSFORMS = ['trim', 'uppercase', 'lowercase'] as const;
export type ListTransform = (typeof X_LT_TRANSFORMS)[number];
export const WIDTH_TOKENS = ['xs', 'sm', 'md', 'fill'] as const;
export type WidthToken = (typeof WIDTH_TOKENS)[number];

/** A closed list this long or longer is picked from a type-ahead, not shown as one chip per option. */
export const PICKER_OPTION_THRESHOLD = 15;
/** A list longer than this shows its first items and a "Show N more" control. */
export const DEFAULT_COLLAPSE_AFTER = 3;

export type ListControl = 'pills' | 'rows' | 'chips' | 'picker' | 'json';

function isSchema(value: unknown): value is Schema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The non-null types a schema declares, from a string or a type array. */
export function declaredTypes(schema: Schema | null | undefined): string[] {
  const type = schema?.type;
  const all = typeof type === 'string' ? [type] : Array.isArray(type) ? type : [];
  return all.filter((t): t is string => typeof t === 'string' && t !== 'null');
}

/** Whether the schema's `type` admits null (`["array", "null"]`). */
export function isNullableType(schema: Schema | null | undefined): boolean {
  const type = schema?.type;
  return Array.isArray(type) && type.includes('null');
}

/** The one concrete type a schema declares, or undefined when it declares none or several. */
export function singleType(schema: Schema | null | undefined): string | undefined {
  const types = declaredTypes(schema);
  return types.length === 1 ? types[0] : undefined;
}

/** Whether the schema declares a list, nullable or not. */
export function isListSchema(schema: Schema | null | undefined): boolean {
  return declaredTypes(schema).includes('array');
}

/** The item schema of a list, or undefined when `items` is absent or not an object schema. */
export function itemSchemaOf(schema: Schema | null | undefined): Schema | undefined {
  return isSchema(schema?.items) ? (schema?.items as Schema) : undefined;
}

/** Whether an item schema describes an object entry (rows). */
export function isObjectItems(items: Schema | undefined): boolean {
  if (!items) return false;
  return singleType(items) === 'object' || isSchema(items.properties);
}

/** Whether an item schema describes a scalar entry (pills). */
export function isScalarItems(items: Schema | undefined): boolean {
  const type = singleType(items);
  return type === 'string' || type === 'number' || type === 'integer';
}

/**
 * The control a list field renders with, or null when the schema gives a list
 * no editable shape. An explicit `x-lt-widget` wins, then the option list,
 * then the shape of `items`. A scan sink keeps its own checklist.
 */
export function listControlOf(schema: Schema | null | undefined, optionCount?: number): ListControl | null {
  if (!schema || !isListSchema(schema)) return null;
  const widget = schema[X_LT_WIDGET];
  if (widget === LIST_WIDGETS.JSON) return 'json';
  if (widget === LIST_WIDGETS.ROWS) return 'rows';
  if (widget === LIST_WIDGETS.PILLS) return schema[X_LT_OPTIONS] !== undefined ? pickerOrChips(schema, optionCount) : 'pills';
  if (readScanSink(schema)) return null;
  if (schema[X_LT_OPTIONS] !== undefined) return pickerOrChips(schema, optionCount);
  const items = itemSchemaOf(schema);
  if (isObjectItems(items)) return 'rows';
  if (isScalarItems(items)) return 'pills';
  return null;
}

function pickerOrChips(schema: Schema, optionCount: number | undefined): 'chips' | 'picker' {
  if (schema['x-lt-display'] === 'picker') return 'picker';
  if (schema[X_LT_WIDGET] === LIST_WIDGETS.PILLS) return 'picker';
  return optionCount !== undefined && optionCount >= PICKER_OPTION_THRESHOLD ? 'picker' : 'chips';
}

/** Whether a list is answered through a control (so it is validated and `required` means one item). */
export function isEditableListSchema(schema: Schema | null | undefined): boolean {
  if (!schema || schema.readOnly === true) return false;
  return listControlOf(schema) !== null;
}

/** Property names of an object item in column order: `x-lt-order` first, the rest as declared. */
export function itemColumnOrder(items: Schema | undefined): string[] {
  const properties = isSchema(items?.properties) ? (items?.properties as Schema) : {};
  const declared = Object.keys(properties);
  const order = Array.isArray(items?.['x-lt-order']) ? (items?.['x-lt-order'] as unknown[]) : [];
  const first = order.filter((k): k is string => typeof k === 'string' && declared.includes(k));
  return [...new Set([...first, ...declared])];
}

/** The transforms a list item commits through; trim is always first. */
export function readTransforms(items: Schema | undefined): ListTransform[] {
  const raw = items?.['x-lt-transform'];
  const named = (Array.isArray(raw) ? raw : [raw]).filter(
    (t): t is ListTransform => typeof t === 'string' && (X_LT_TRANSFORMS as readonly string[]).includes(t) && t !== 'trim',
  );
  return ['trim', ...named];
}

export function applyTransforms(text: string, transforms: readonly ListTransform[]): string {
  return transforms.reduce((acc, t) => {
    if (t === 'uppercase') return acc.toUpperCase();
    if (t === 'lowercase') return acc.toLowerCase();
    return acc.trim();
  }, text);
}

export interface ListLocator {
  /** The document an item points into: its `x-lt-source` (such as `file.review`) or its field key. The first document when absent. */
  file?: string;
  page?: string;
  quote?: string;
}

/** The locator a list declares, or null when none is declared or it names nothing. */
export function readLocator(schema: Schema | null | undefined): ListLocator | null {
  const raw = schema?.['x-lt-locate'] ?? itemSchemaOf(schema)?.['x-lt-locate'];
  if (!isSchema(raw)) return null;
  const pick = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
  const spec = { file: pick(raw.file), page: pick(raw.page), quote: pick(raw.quote) };
  return spec.page || spec.quote ? spec : null;
}

export interface ListSpec {
  sortable: boolean;
  unordered: boolean;
  itemKey?: string;
  itemLayout?: string;
  itemTitle?: string;
  collapseAfter: number;
  addLabel?: string;
  suggest?: string;
}

/** The presentation and comparison tokens of a list field, with defaults. */
export function readListSpec(schema: Schema | null | undefined): ListSpec {
  const text = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
  const collapse = schema?.['x-lt-collapse-after'];
  return {
    sortable: schema?.['x-lt-sortable'] === true,
    unordered: schema?.['x-lt-unordered'] === true,
    itemKey: text(schema?.['x-lt-item-key']),
    itemLayout: text(schema?.['x-lt-item-layout']),
    itemTitle: text(schema?.['x-lt-item-title']),
    collapseAfter: typeof collapse === 'number' && Number.isInteger(collapse) && collapse > 0 ? collapse : DEFAULT_COLLAPSE_AFTER,
    addLabel: text(schema?.['x-lt-add-label']),
    suggest: text(schema?.['x-lt-suggest']),
  };
}

/** Whether a list shows items as evidence (a body line plus small labeled attributes). */
export function isEvidenceLayout(layout: string | undefined): boolean {
  return layout === X_LT_ITEM_LAYOUTS.EVIDENCE || layout === X_LT_ITEM_LAYOUTS.CARD;
}

/** A column's width token, or undefined for the default. */
export function readWidth(propertySchema: Schema | null | undefined): WidthToken | undefined {
  const w = propertySchema?.['x-lt-width'];
  return typeof w === 'string' && (WIDTH_TOKENS as readonly string[]).includes(w) ? (w as WidthToken) : undefined;
}

const PILLS_SHORTCUTS = [
  '**Pills**',
  '- Enter, Tab or a comma adds what you typed. Pasting several values adds one pill each.',
  '- Backspace in an empty box selects the last pill; Backspace again removes it.',
  '- Left and Right move between pills. Enter edits a pill; Delete removes it.',
  '- Alt with Left or Right moves a pill when the list is sortable.',
];

const ROWS_SHORTCUTS = [
  '**Rows**',
  '- Tab moves from cell to cell. Escape puts back the cell you are in.',
  '- Enter in the last cell adds a row. Alt+Enter duplicates the row; Alt+Delete removes it.',
  '- Alt with Up or Down moves a row when the list is sortable.',
  '- Paste copied spreadsheet cells to fill from the cell you are in.',
];

/** Keyboard help for the list controls a form uses, or null when it has none. */
export function listShortcutsMarkdown(formSchema: Schema | null | undefined): string | null {
  const properties = isSchema(formSchema?.properties) ? (formSchema?.properties as Record<string, Schema>) : {};
  const controls = new Set(Object.values(properties).map((def) => (isSchema(def) && def.readOnly !== true ? listControlOf(def) : null)));
  const sections = [
    controls.has('pills') || controls.has('picker') ? PILLS_SHORTCUTS : null,
    controls.has('rows') ? ROWS_SHORTCUTS : null,
  ].filter((s): s is string[] => s !== null);
  return sections.length === 0 ? null : ['### Lists', ...sections.map((s) => s.join('\n'))].join('\n\n');
}
