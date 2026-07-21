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
 * form. Two-column mode splits the run across a responsive pair of lists.
 */
export function DictionaryList({ items, columns = 1 }: {
  items: DictionaryItem[];
  columns?: number;
}) {
  if (items.length === 0) return null;

  if (columns >= 2 && items.length > 1) {
    const mid = Math.ceil(items.length / 2);
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-col-gap gap-y-1.5 items-start">
        <DictionaryColumn items={items.slice(0, mid)} />
        <DictionaryColumn items={items.slice(mid)} />
      </div>
    );
  }

  return <DictionaryColumn items={items} />;
}

function DictionaryColumn({ items }: { items: DictionaryItem[] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-6 gap-y-1.5">
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
