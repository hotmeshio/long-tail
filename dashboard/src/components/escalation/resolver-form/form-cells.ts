/**
 * Layout cell partitioning for the schema-driven resolver form.
 *
 * A section's fields render as a sequence of cells:
 * - `dictionary` — consecutive read-only facts merged into one dense
 *   definition list (`x-lt-display: "dictionary"` at field, section, or
 *   schema level)
 * - `column-group` — consecutive fields sharing an `x-lt-column-group` name,
 *   rendered as an inner two-column grid inside one cell of a two-column
 *   layout (the 2×2 nesting level)
 * - `field` — everything else, one input per cell
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type FormEntry = [string, JsonValue];

export interface SectionOptions {
  display?: string;
  columns?: number;
}

export type FormCell =
  | { kind: 'field'; entry: FormEntry }
  | { kind: 'dictionary'; entries: FormEntry[] }
  | { kind: 'column-group'; name: string; entries: FormEntry[] };

const DICTIONARY = 'dictionary';

/** Widgets that render content blocks even when readOnly — never dictionary rows. */
const CONTENT_WIDGETS = new Set(['markdown', 'attachment', 'image']);

export function sectionOptionsFor(
  formSchema: Record<string, any> | null | undefined,
  sectionName: string | null,
): SectionOptions | undefined {
  if (!sectionName) return undefined;
  const all = formSchema?.['x-lt-section-options'] as Record<string, SectionOptions> | undefined;
  const opts = all?.[sectionName];
  return opts && typeof opts === 'object' ? opts : undefined;
}

/**
 * A field renders as a dictionary row when it is read-only, is not a content
 * widget, and dictionary display is requested at the nearest level:
 * field `x-lt-display` > section options > schema-root `x-lt-display`.
 */
export function isDictionaryField(
  formSchema: Record<string, any> | null | undefined,
  sectionName: string | null,
  key: string,
): boolean {
  const fieldSchema = formSchema?.properties?.[key] as Record<string, unknown> | undefined;
  if (fieldSchema?.readOnly !== true) return false;
  const widget = fieldSchema?.['x-lt-widget'];
  if (typeof widget === 'string' && CONTENT_WIDGETS.has(widget)) return false;

  const fieldDisplay = fieldSchema?.['x-lt-display'];
  if (typeof fieldDisplay === 'string') return fieldDisplay === DICTIONARY;
  const sectionDisplay = sectionOptionsFor(formSchema, sectionName)?.display;
  if (typeof sectionDisplay === 'string') return sectionDisplay === DICTIONARY;
  return formSchema?.['x-lt-display'] === DICTIONARY;
}

export function partitionCells(
  entries: FormEntry[],
  formSchema: Record<string, any> | null | undefined,
  sectionName: string | null,
  layout: string | undefined,
): FormCell[] {
  const cells: FormCell[] = [];
  for (const entry of entries) {
    const [key] = entry;
    const last = cells[cells.length - 1];

    if (isDictionaryField(formSchema, sectionName, key)) {
      if (last?.kind === 'dictionary') {
        last.entries.push(entry);
      } else {
        cells.push({ kind: 'dictionary', entries: [entry] });
      }
      continue;
    }

    const fieldSchema = formSchema?.properties?.[key] as Record<string, unknown> | undefined;
    const groupName = fieldSchema?.['x-lt-column-group'];
    if (layout === 'two-column' && typeof groupName === 'string' && groupName.trim()) {
      if (last?.kind === 'column-group' && last.name === groupName) {
        last.entries.push(entry);
      } else {
        cells.push({ kind: 'column-group', name: groupName, entries: [entry] });
      }
      continue;
    }

    cells.push({ kind: 'field', entry });
  }
  return cells;
}
