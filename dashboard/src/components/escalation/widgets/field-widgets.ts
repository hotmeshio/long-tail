import { WIDGET_MAP } from './index';

/** `x-lt-widget: textarea` is an alias of `format: "textarea"`. */
export const TEXTAREA_WIDGET = 'textarea';
/** Rendered by FieldRow itself rather than through the widget registry. */
export const JSON_WIDGET = 'json';

export function isKnownWidget(name: string): boolean {
  return name in WIDGET_MAP || name === TEXTAREA_WIDGET || name === JSON_WIDGET;
}

export interface UnknownWidget {
  /** Dotted path to the field, e.g. `notes` or `items.label`. */
  path: string;
  widget: string;
}

/** Every `x-lt-widget` in a form schema that names no known widget, in document order. */
export function findUnknownWidgets(schema: unknown, path = ''): UnknownWidget[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const node = schema as Record<string, unknown>;
  const found: UnknownWidget[] = [];
  const widget = node['x-lt-widget'];
  if (typeof widget === 'string' && path && !isKnownWidget(widget)) found.push({ path, widget });
  const properties = node.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [key, child] of Object.entries(properties)) {
      found.push(...findUnknownWidgets(child, path ? `${path}.${key}` : key));
    }
  }
  if (node.items) found.push(...findUnknownWidgets(node.items, path));
  return found;
}
