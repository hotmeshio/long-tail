import { useMemo, useState } from 'react';
import { FieldLabel, FieldHelper } from '../FieldChrome';
import type { JsonValue } from '../form-cells';
import { resolveFieldOptions } from '../../../../lib/x-lt-options';
import { deriveFieldLabel } from '../../../../lib/derive-field-label';
import { isEvidenceLayout, isObjectItems, itemColumnOrder, itemSchemaOf, readListSpec, readWidth, type WidthToken } from '../../../../lib/x-lt-list';
import { Pill } from './Pill';
import { asItems, keyWords } from './list-ops';
import { confidenceToneOf, useListReview } from './list-review';
import { useLocateItem } from './use-locate';
import { formatReviewValue } from '../review-value';

type Schema = Record<string, any>;
const isRecord = (v: unknown): v is Record<string, JsonValue> => v !== null && typeof v === 'object' && !Array.isArray(v);
const WIDTH_CLASS: Record<WidthToken, string> = { xs: 'w-20', sm: 'w-36', md: 'w-56', fill: 'w-auto' };

/** One attribute value as an auditor reads it: Yes/No, option labels, joined lists. */
export function formatItemValue(value: unknown, cell?: Schema, context?: Record<string, unknown>): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const options = cell ? resolveFieldOptions(cell, context) : undefined;
  const labelOf = (v: unknown) => options?.find((o) => o.value === v)?.label ?? String(v);
  if (Array.isArray(value)) return value.map((v) => (isRecord(v) ? JSON.stringify(v) : labelOf(v))).join(', ');
  if (isRecord(value)) return JSON.stringify(value);
  return labelOf(value);
}

/** The line an evidence entry leads with: `x-lt-item-title`, else the first text value. */
export function evidenceTitle(item: Record<string, JsonValue>, titleKey: string | undefined): string | undefined {
  if (titleKey && typeof item[titleKey] === 'string') return item[titleKey] as string;
  return Object.values(item).find((v): v is string => typeof v === 'string' && v.length > 0);
}

function MarkLabel({ kind, was }: { kind?: 'same' | 'added' | 'edited'; was?: string }) {
  if (kind === 'added') return <span className="text-2xs font-medium text-status-active">Added</span>;
  if (kind === 'edited') return <span className="text-2xs font-medium text-accent">Edited{was ? ` · was ${was}` : ''}</span>;
  return null;
}

function Evidence({ item, titleKey, properties }: { item: Record<string, JsonValue>; titleKey?: string; properties: Record<string, Schema> }) {
  const title = evidenceTitle(item, titleKey);
  const lead = titleKey && typeof item[titleKey] === 'string' ? titleKey : Object.keys(item).find((k) => item[k] === title);
  const rest = Object.entries(item).filter(([k]) => k !== lead);
  return (
    <div className="py-1.5">
      {title && <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{title}</p>}
      {rest.length > 0 && (
        <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5">
          {rest.map(([k, v]) => (
            <div key={k} className="flex gap-1 text-2xs">
              <dt className="text-text-tertiary">{properties[k]?.title ?? keyWords(k)}</dt>
              <dd className="text-text-secondary">{formatItemValue(v, properties[k])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ReadOnlyTable({ rows, itemSchema, context }: { rows: JsonValue[]; itemSchema: Schema; context?: Record<string, unknown> }) {
  const review = useListReview();
  const columns = itemColumnOrder(itemSchema);
  const properties = (itemSchema.properties ?? {}) as Record<string, Schema>;
  return (
    <div className="@container">
      <div role="table" className="block @table:table w-full text-sm">
        <div role="rowgroup" className="hidden @table:table-header-group">
          <div role="row" className="table-row">
            {columns.map((name) => (
              <div key={name} role="columnheader" className={`table-cell pb-1 pr-3 text-2xs font-semibold uppercase tracking-wider text-text-secondary ${WIDTH_CLASS[readWidth(properties[name]) ?? 'fill']}`}>
                {deriveFieldLabel(name, properties[name])}
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup" className="block @table:table-row-group">
          {rows.map((row, i) => (
            <div
              key={i}
              role="row"
              data-row-mark={review?.diff?.marks[i]?.kind}
              data-confidence-tone={confidenceToneOf(review?.itemTranches?.[i])}
              className="block @table:table-row border-t border-surface-field-border first:border-t-0 py-1.5 @table:py-0"
            >
              {columns.map((name, c) => {
                const mark = review?.diff?.marks[i];
                const proposed = (mark?.proposed ?? {}) as Record<string, JsonValue>;
                return (
                  <div key={name} role="cell" data-confidence-tone={review?.cellTranches?.[i]?.[name]?.tone} className="block @table:table-cell @table:py-1 @table:pr-3 text-text-primary break-words">
                    {c === 0 && mark?.kind === 'added' && <MarkLabel kind="added" />}
                    <span aria-hidden className="@table:hidden mr-2 text-2xs font-semibold uppercase tracking-wider text-text-secondary">{deriveFieldLabel(name, properties[name])}</span>
                    {formatItemValue(isRecord(row) ? row[name] : undefined, properties[name], context)}
                    {mark?.kind === 'edited' && mark.cells?.includes(name) && (
                      <span className="block text-2xs text-accent">Edited · was {formatReviewValue(proposed[name], properties[name], context)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A list shown, not edited: the same display in a read-only field, the locked
 * form, the resolved row and the escalation detail. Scalars read as pills,
 * declared rows as a table, evidence as a body line with small labeled
 * attributes. A long list shows its first items and "Show N more".
 */
export function ListDisplay({ fieldKey, label, value, fieldSchema, context, helperText, isRequired, ids }: {
  fieldKey: string;
  label: string;
  value: JsonValue;
  fieldSchema: Schema | undefined;
  context?: Record<string, unknown>;
  helperText?: string;
  isRequired?: boolean;
  ids: { help: string };
}) {
  const items = asItems(value);
  const spec = readListSpec(fieldSchema);
  const itemSchema = itemSchemaOf(fieldSchema) as Schema | undefined;
  const [expanded, setExpanded] = useState(false);
  const review = useListReview();
  const locate = useLocateItem(fieldSchema);
  const options = useMemo(() => resolveFieldOptions(fieldSchema, context), [fieldSchema, context]);
  const objects = items.length > 0 && items.every(isRecord);
  const declared = isObjectItems(itemSchema) && !!itemSchema?.properties;
  const asEvidence = objects && (isEvidenceLayout(spec.itemLayout) || !declared);
  const shown = expanded ? items : items.slice(0, spec.collapseAfter);
  const hidden = items.length - shown.length;

  return (
    <div data-field-key={fieldKey} tabIndex={-1} className="outline-none">
      <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
      {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
      {value === null && <p className="text-xs italic text-text-tertiary mt-1">Not stated</p>}
      {value !== null && items.length === 0 && <p className="text-xs italic text-text-tertiary mt-1">None</p>}
      {items.length > 0 && (
        <div className="mt-1">
          {objects && asEvidence && (
            <div role="list" className="divide-y divide-surface-field-border">
              {shown.map((item, i) => (
                <div
                  key={i}
                  role="listitem"
                  data-confidence-tone={confidenceToneOf(review?.itemTranches?.[i])}
                  tabIndex={locate ? 0 : undefined}
                  onFocus={locate ? () => locate(item) : undefined}
                  onClick={locate ? () => locate(item) : undefined}
                  className={locate ? 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm' : undefined}
                >
                  <MarkLabel kind={review?.diff?.marks[i]?.kind} was={review?.diff?.marks[i]?.kind === 'edited' ? formatReviewValue([review.diff.marks[i].proposed], fieldSchema, context) : undefined} />
                  <Evidence item={item as Record<string, JsonValue>} titleKey={spec.itemTitle} properties={(itemSchema?.properties ?? {}) as Record<string, Schema>} />
                </div>
              ))}
            </div>
          )}
          {objects && !asEvidence && <ReadOnlyTable rows={shown} itemSchema={itemSchema!} context={context} />}
          {!objects && (
            <div role="list" className="flex flex-wrap gap-1.5">
              {shown.map((v, i) => {
                const mark = review?.diff?.marks[i];
                const was = mark?.kind === 'edited' ? formatReviewValue(mark.proposed, fieldSchema, context) : undefined;
                return (
                  <Pill
                    key={i}
                    text={options?.find((o) => o.value === v)?.label ?? formatItemValue(v)}
                    tone={mark?.kind === 'added' ? 'added' : mark?.kind === 'edited' ? 'edited' : 'default'}
                    title={was ? `Proposed: ${was}` : mark?.kind === 'added' ? 'Added' : undefined}
                    suffix={was ? `was ${was}` : undefined}
                    confidence={confidenceToneOf(review?.itemTranches?.[i])}
                  />
                );
              })}
            </div>
          )}
          {hidden > 0 && (
            <button type="button" onClick={() => setExpanded(true)} className="mt-1 text-2xs font-medium text-accent hover:underline underline-offset-2">
              Show {hidden} more
            </button>
          )}
          {expanded && items.length > spec.collapseAfter && (
            <button type="button" onClick={() => setExpanded(false)} className="mt-1 text-2xs font-medium text-text-tertiary hover:underline underline-offset-2">
              Show fewer
            </button>
          )}
        </div>
      )}
      {review?.diff && review.diff.removed.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {review.diff.removed.map((r, i) => (
            <li key={i} className="flex gap-2 text-2xs text-text-quaternary"><s className="truncate">{formatReviewValue([r.item], fieldSchema, context)}</s><span>removed</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
