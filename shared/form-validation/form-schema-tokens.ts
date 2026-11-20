/**
 * Authoring check for the list tokens of a form schema. A malformed token is
 * refused when the schema is written (role save, seed, `validate_schema`), so
 * a bad form fails at boot and never in front of a reviewer. Returns the
 * first problem as a message naming the field, or null when the schema is
 * sound. Only list tokens are judged; every other token keeps its reading.
 */
import {
  LIST_WIDGETS,
  WIDTH_TOKENS,
  X_LT_ITEM_LAYOUTS,
  X_LT_TRANSFORMS,
  isListSchema,
  isObjectItems,
  isScalarItems,
  itemSchemaOf,
  X_LT_WIDGET,
} from './x-lt-list';
import { X_LT_OPTIONS } from './x-lt-options';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const oneOf = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);

function itemTokenError(path: string, items: Obj): string | null {
  const properties = isObj(items.properties) ? items.properties : null;
  const names = properties ? Object.keys(properties) : null;
  const order = items['x-lt-order'];
  if (order !== undefined) {
    if (!Array.isArray(order) || !order.every(isText)) return `${path}: items x-lt-order must be a list of property names`;
    const unknown = names ? order.find((k) => !names.includes(k as string)) : undefined;
    if (unknown) return `${path}: items x-lt-order names "${unknown}", which is not an item property`;
  }
  const transform = items['x-lt-transform'];
  if (transform !== undefined) {
    const all = Array.isArray(transform) ? transform : [transform];
    if (!all.every((t) => oneOf(X_LT_TRANSFORMS, t))) return `${path}: items x-lt-transform must be ${X_LT_TRANSFORMS.join(', ')}`;
  }
  for (const [name, cell] of Object.entries(properties ?? {})) {
    if (!isObj(cell)) continue;
    if (cell['x-lt-width'] !== undefined && !oneOf(WIDTH_TOKENS, cell['x-lt-width'])) {
      return `${path}.${name}: x-lt-width must be ${WIDTH_TOKENS.join(', ')}`;
    }
    const nested = listTokenError(`${path}.${name}`, cell);
    if (nested) return nested;
  }
  return null;
}

function locateError(path: string, schema: Obj, items: Obj | undefined): string | null {
  const locate = schema['x-lt-locate'] ?? items?.['x-lt-locate'];
  if (locate === undefined) return null;
  if (!isObj(locate)) return `${path}: x-lt-locate must be an object`;
  const keys = ['file', 'page', 'quote'] as const;
  if (keys.some((k) => locate[k] !== undefined && !isText(locate[k]))) return `${path}: x-lt-locate file, page and quote must be names`;
  if (!isText(locate.page) && !isText(locate.quote)) return `${path}: x-lt-locate must name a page or a quote`;
  const names = isObj(items?.properties) ? Object.keys(items?.properties as Obj) : null;
  // `file` names a document (its x-lt-source or field key); page and quote name item properties.
  const unknown = names ? [locate.page, locate.quote].find((n) => isText(n) && !names.includes(n)) : undefined;
  return unknown ? `${path}: x-lt-locate names "${unknown}", which is not an item property` : null;
}

function listTokenError(path: string, schema: Obj): string | null {
  if (!isListSchema(schema)) return null;
  const items = itemSchemaOf(schema);
  const widget = schema[X_LT_WIDGET];
  if (widget === LIST_WIDGETS.ROWS && !isObjectItems(items)) return `${path}: x-lt-widget "rows" needs items of type object`;
  if (widget === LIST_WIDGETS.PILLS && !isScalarItems(items) && schema[X_LT_OPTIONS] === undefined) {
    return `${path}: x-lt-widget "pills" needs scalar items or x-lt-options`;
  }
  for (const key of ['x-lt-sortable', 'x-lt-unordered'] as const) {
    if (schema[key] !== undefined && typeof schema[key] !== 'boolean') return `${path}: ${key} must be true or false`;
  }
  const collapse = schema['x-lt-collapse-after'];
  if (collapse !== undefined && !(typeof collapse === 'number' && Number.isInteger(collapse) && collapse > 0)) {
    return `${path}: x-lt-collapse-after must be a positive whole number`;
  }
  for (const key of ['x-lt-add-label', 'x-lt-suggest', 'x-lt-item-title'] as const) {
    if (schema[key] !== undefined && !isText(schema[key])) return `${path}: ${key} must be text`;
  }
  const layout = schema['x-lt-item-layout'];
  if (layout !== undefined && !oneOf(Object.values(X_LT_ITEM_LAYOUTS), layout)) {
    return `${path}: x-lt-item-layout must be ${Object.values(X_LT_ITEM_LAYOUTS).join(', ')}`;
  }
  const names = isObj(items?.properties) ? Object.keys(items?.properties as Obj) : null;
  for (const key of ['x-lt-item-key', 'x-lt-item-title'] as const) {
    const named = schema[key];
    if (isText(named) && names && !names.includes(named)) return `${path}: ${key} names "${named}", which is not an item property`;
  }
  return locateError(path, schema, items) ?? (items ? itemTokenError(path, items) : null);
}

/** The first malformed list token in a form schema, or null. */
export function formSchemaTokenError(schema: unknown): string | null {
  if (!isObj(schema) || !isObj(schema.properties)) return null;
  for (const [name, field] of Object.entries(schema.properties)) {
    if (!isObj(field)) continue;
    const message = listTokenError(name, field);
    if (message) return message;
  }
  return null;
}
