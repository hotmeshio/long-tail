import { Fragment } from 'react';
import { type JsonValue } from './form-cells';

export interface DictionaryItem {
  key: string;
  label: string;
  value: JsonValue;
}

/**
 * Dense definition-list display for read-only label/value facts — the compact
 * alternative to full-height field rows. Labels sit beside values in a
 * max-content column so a run of short facts reads like a spec sheet, not a
 * form.
 *
 * The poster child of the responsive doctrine: geometry follows the
 * CONTAINER. The same pairs render as two pairs per row (≥ @dict-pairs),
 * one label|value pair per row (≥ @dict-inline), or label stacked over
 * value below that — however narrow a side panel squeezes the form.
 * Two-column mode fills ROW BY ROW, so the author's ordering controls
 * pairing (Left Qty beside Right Qty, Left first) in every geometry.
 */
export function DictionaryList({ items, columns = 1 }: {
  items: DictionaryItem[];
  columns?: number;
}) {
  if (items.length === 0) return null;

  const gridCols = columns >= 2 && items.length > 1
    ? 'grid-cols-1 @dict-inline:grid-cols-[max-content_1fr] @dict-pairs:grid-cols-[max-content_1fr_max-content_1fr]'
    : 'grid-cols-1 @dict-inline:grid-cols-[max-content_1fr]';

  return (
    <div className="@container">
      <dl className={`grid ${gridCols} items-baseline gap-x-6 @dict-pairs:gap-x-8 gap-y-1.5`}>
        {items.map(({ key, label, value }) => (
          <Fragment key={key}>
            {/* Stacked geometry clusters each label with its value. */}
            <dt className="text-2xs font-semibold uppercase tracking-wide text-text-secondary mt-2 first:mt-0 @dict-inline:mt-0">
              {label}
            </dt>
            <dd className="text-sm text-text-primary break-words min-w-0" data-field-key={key}>
              {formatDictionaryValue(value)}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function formatDictionaryValue(value: JsonValue): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
