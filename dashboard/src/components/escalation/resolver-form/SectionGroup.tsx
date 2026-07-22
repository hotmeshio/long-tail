import { type ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { deriveFieldLabel } from '../../../lib/derive-field-label';
import { DictionaryList } from './DictionaryList';
import {
  partitionCells,
  sectionOptionsFor,
  type FormEntry,
  type JsonValue,
} from './form-cells';

/**
 * One visual section of the resolver form: optional named chrome (accent rule,
 * sunken band, section header), then the section's fields laid out as cells —
 * dictionary runs, 2×2 column groups, and single fields.
 */
export function SectionGroup({ name, entries, formSchema, layout, renderField }: {
  name: string | null;
  entries: FormEntry[];
  formSchema: Record<string, any> | null;
  layout: string | undefined;
  renderField: (entry: FormEntry) => ReactNode;
}) {
  const cells = partitionCells(entries, formSchema, name, layout);
  const options = sectionOptionsFor(formSchema, name);
  const dictionaryColumns = options?.columns ?? (layout === 'two-column' ? 2 : 1);

  const dictionaryItems = (dictEntries: FormEntry[]) =>
    dictEntries.map(([key, value]: [string, JsonValue]) => ({
      key,
      label: deriveFieldLabel(key, formSchema?.properties?.[key] as Record<string, unknown> | undefined),
      value,
    }));

  const renderCells = () =>
    cells.map((cell, i) => {
      if (cell.kind === 'dictionary') {
        return (
          <div key={`dict-${i}`} className={layout === 'two-column' ? 'col-span-full' : ''}>
            <DictionaryList items={dictionaryItems(cell.entries)} columns={dictionaryColumns} />
          </div>
        );
      }
      if (cell.kind === 'column-group') {
        // One cell of the outer two-column grid holding its own two columns —
        // the single extra nesting level (2×2).
        return (
          <div key={`group-${cell.name}-${i}`} className="grid grid-cols-2 gap-x-4 gap-y-5">
            {cell.entries.map((entry) => renderField(entry))}
          </div>
        );
      }
      return renderField(cell.entry);
    });

  return (
    <div
      className={name
        // Sections sit on the sunken band — a shade DARKER than the field
        // fill, so embedded inputs pop against the group the same way they
        // pop against the filter bars. Theme-driven, never a hardcoded hex.
        ? 'border-l-2 border-accent/30 bg-surface-sunken/80 rounded-[0.125em] p-4 animate-[section-enter_0.25s_ease-out]'
        : ''}
    >
      {name && (
        <div className="mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4 text-accent/60 shrink-0" strokeWidth={1.5} />
          <p className="text-[0.9375rem] font-semibold uppercase tracking-widest text-heading">
            {name}
          </p>
        </div>
      )}
      {layout === 'two-column' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-col-gap gap-y-5">
          {renderCells()}
        </div>
      ) : (
        <div className="space-y-5">
          {renderCells()}
        </div>
      )}
    </div>
  );
}
