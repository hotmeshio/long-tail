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
 * Two-column mode fills ROW BY ROW: consecutive items share a row, so the
 * author's ordering controls pairing — Left Qty and Right Qty declared
 * together render side by side, Left first (the left/right law). Below md
 * the same order stacks one pair per row.
 */
export function DictionaryList({ items, columns = 1 }: {
  items: DictionaryItem[];
  columns?: number;
}) {
  if (items.length === 0) return null;

  const gridCols = columns >= 2 && items.length > 1
    ? 'grid-cols-[max-content_1fr] md:grid-cols-[max-content_1fr_max-content_1fr]'
    : 'grid-cols-[max-content_1fr]';

  return (
    <dl className={`grid ${gridCols} items-baseline gap-x-6 md:gap-x-8 gap-y-1.5`}>
      {items.map(({ key, label, value }) => (
        <Fragment key={key}>
          <dt className="text-2xs font-semibold uppercase tracking-wide text-text-secondary">
            {label}
          </dt>
          <dd className="text-sm text-text-primary break-words min-w-0" data-field-key={key}>
            {formatDictionaryValue(value)}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function formatDictionaryValue(value: JsonValue): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
