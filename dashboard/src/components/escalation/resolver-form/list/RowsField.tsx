import { useMemo, useRef } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { FieldLabel, FieldHelper, FieldError, BareChromeContext } from '../FieldChrome';
import { FieldRow } from '../FieldRow';
import type { FieldControlProps } from '../field-control-props';
import type { JsonValue } from '../form-cells';
import { evaluateShowIf, type ShowIfContext } from '../../../../lib/x-lt-show-if';
import { deriveFieldLabel } from '../../../../lib/derive-field-label';
import { isNullableType, itemColumnOrder, itemSchemaOf, readListSpec, readWidth, validateListItems, type WidthToken } from '../../../../lib/x-lt-list';
import { appendItem, asItems, duplicateAt, moveItem, newRow, pasteGrid, removeAt, replaceAt } from './list-ops';
import { useListReview } from './list-review';
import { useLocateItem } from './use-locate';
import { formatReviewValue } from '../review-value';

type Schema = Record<string, any>;

const WIDTH_CLASS: Record<WidthToken, string> = { xs: 'w-20', sm: 'w-36', md: 'w-56', fill: 'w-auto' };
/** Whether the control is the last one in its row, so Enter there starts the next row. */
function isLastControl(target: HTMLElement): boolean {
  const controls = target.closest('[data-row]')?.querySelectorAll('input, select, textarea');
  return !!controls && controls[controls.length - 1] === target;
}
const cellError = (message: string | undefined) => message?.slice(message.indexOf(': ') + 2);

/**
 * A list of objects as an editable table: one row per item, one column per
 * declared property, each cell the control its property declares. Below the
 * `@table` container width each row folds into labeled cells. Properties the
 * schema does not declare ride along untouched.
 */
export function RowsField({ value, fieldSchema, context, locked, fieldKey, label, helperText, isRequired, error, onBlur, ids, ariaProps, onChange }: FieldControlProps & {
  value: JsonValue;
  fieldSchema: Schema | undefined;
  context?: Record<string, unknown>;
  locked?: boolean;
}) {
  const rows = asItems(value);
  const itemSchema = itemSchemaOf(fieldSchema) as Schema | undefined;
  const columns = useMemo(() => itemColumnOrder(itemSchema), [itemSchema]);
  const properties = useMemo(() => (itemSchema?.properties ?? {}) as Record<string, Schema>, [itemSchema]);
  const cellSchemas = useMemo(
    () => Object.fromEntries(columns.map((name) => [name, { ...properties[name], title: deriveFieldLabel(name, properties[name]) }])) as Record<string, Schema>,
    [columns, properties],
  );
  const required = new Set<string>(Array.isArray(itemSchema?.required) ? itemSchema!.required : []);
  const spec = readListSpec(fieldSchema);
  const nullable = isNullableType(fieldSchema);
  const min = typeof fieldSchema?.minItems === 'number' ? (fieldSchema.minItems as number) : undefined;
  const max = typeof fieldSchema?.maxItems === 'number' ? (fieldSchema.maxItems as number) : undefined;
  const canAdd = max === undefined || rows.length < max;
  const canRemove = min === undefined || rows.length > min;
  const addLabel = spec.addLabel ?? 'Add row';
  const review = useListReview();
  const locate = useLocateItem(fieldSchema);
  const located = useRef(-1);
  const body = useRef<HTMLDivElement>(null);
  const snapshot = useRef<{ key: string; value: JsonValue } | null>(null);

  const errors = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of validateListItems(rows, fieldSchema ?? {}, context)) if (e.cell) map.set(`${e.index}:${e.cell}`, e.message);
    return map;
  }, [rows, fieldSchema, context]);

  const commit = (next: JsonValue[]) => { onChange(next); onBlur?.(); };
  const addRow = () => {
    if (!canAdd) return;
    commit(appendItem(rows, newRow(itemSchema)));
    setTimeout(() => body.current?.querySelector<HTMLElement>(`[data-row="${rows.length}"] input, [data-row="${rows.length}"] select, [data-row="${rows.length}"] textarea`)?.focus(), 0);
  };
  const setCell = (index: number, name: string, next: JsonValue) => {
    const row = { ...((rows[index] ?? {}) as Record<string, JsonValue>), [name]: next };
    onChange(replaceAt(rows, index, row));
  };

  const cellOf = (e: React.SyntheticEvent): { index: number; name: string } | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    const [i, name] = el?.dataset.cell?.split(':') ?? [];
    return el && i !== undefined && name ? { index: Number(i), name } : null;
  };

  const onFocusCapture = (e: React.FocusEvent) => {
    const at = cellOf(e);
    if (!at) return;
    const key = `${at.index}:${at.name}`;
    if (locate && located.current !== at.index) { located.current = at.index; locate(rows[at.index]); }
    if (snapshot.current?.key !== key) snapshot.current = { key, value: ((rows[at.index] ?? {}) as Record<string, JsonValue>)[at.name] ?? '' };
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = cellOf(e);
    if (!at || locked) return;
    const isText = ['INPUT', 'SELECT'].includes((e.target as HTMLElement).tagName);
    if (e.key === 'Escape' && snapshot.current?.key === `${at.index}:${at.name}`) {
      setCell(at.index, at.name, snapshot.current.value);
    } else if (e.altKey && e.key === 'Delete' && canRemove) {
      e.preventDefault(); commit(removeAt(rows, at.index));
    } else if (e.altKey && e.key === 'Enter' && canAdd) {
      e.preventDefault(); commit(duplicateAt(rows, at.index));
    } else if (e.altKey && spec.sortable && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); commit(moveItem(rows, at.index, e.key === 'ArrowUp' ? -1 : 1));
    } else if (e.key === 'Enter' && isText && at.index === rows.length - 1 && isLastControl(e.target as HTMLElement)) {
      e.preventDefault(); addRow();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const at = cellOf(e);
    const text = e.clipboardData.getData('text');
    if (!at || !/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    commit(pasteGrid(rows, { row: at.index, col: columns.indexOf(at.name) }, text, columns, itemSchema, max));
  };

  const mark = (n: number) => `${label} row ${n + 1}`;
  const forwardFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) body.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  };
  return (
    <div
      role="group"
      aria-label={label}
      aria-required={isRequired || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={ariaProps['aria-describedby']}
      data-field-key={rows.length > 0 ? fieldKey : undefined}
      tabIndex={rows.length > 0 ? -1 : undefined}
      onFocus={forwardFocus}
      className="outline-none"
    >
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
        {nullable && rows.length > 0 && !locked && (
          <button type="button" onClick={() => commit(null as unknown as JsonValue[])} className="text-2xs text-text-tertiary hover:text-accent hover:underline underline-offset-2">
            Clear to &ldquo;not stated&rdquo;
          </button>
        )}
      </div>
      {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
      {rows.length === 0 && (
        <p className="text-xs italic text-text-tertiary mt-1">{value === null ? 'Not stated' : 'No rows'}</p>
      )}
      <BareChromeContext.Provider value>
        <div className="@container mt-1" ref={body} onFocusCapture={onFocusCapture} onKeyDown={onKeyDown} onPaste={onPaste}>
          {rows.length > 0 && (
            <div role="table" aria-label={label} className="block @table:table w-full text-sm [&_.input]:mt-0 [&_.select]:mt-0">
              <div role="rowgroup" className="hidden @table:table-header-group">
                <div role="row" className="table-row">
                  {columns.map((name) => (
                    <div key={name} role="columnheader" className={`table-cell align-bottom pb-1 pr-3 text-2xs font-semibold uppercase tracking-wider text-text-secondary ${WIDTH_CLASS[readWidth(properties[name]) ?? 'fill']}`}>
                      {deriveFieldLabel(name, properties[name])}
                      {required.has(name) && <span className="text-status-error ml-0.5">*</span>}
                    </div>
                  ))}
                  {!locked && <div role="columnheader" className="table-cell w-px"><span className="sr-only">Row actions</span></div>}
                </div>
              </div>
              <div role="rowgroup" className="block @table:table-row-group">
                {rows.map((row, index) => {
                  const rowCtx = { ...(context ?? {}), row: (row ?? {}) as Record<string, unknown> };
                  return (
                    <div
                      key={index}
                      role="row"
                      data-row={index}
                      data-row-mark={review?.diff?.marks[index]?.kind}
                      data-confidence-tone={review?.cellTranches?.[index] ? undefined : review?.itemTranches?.[index]?.tone}
                      className="block @table:table-row border-t border-surface-field-border first:border-t-0 py-2 @table:py-0"
                    >
                      {columns.map((name) => {
                        const cell = properties[name] ?? {};
                        const shown = evaluateShowIf(cell['x-lt-showIf'], rowCtx as ShowIfContext);
                        const cellLabel = deriveFieldLabel(name, cell);
                        const mark = review?.diff?.marks[index];
                        const wasEdited = mark?.kind === 'edited' && mark.cells?.includes(name);
                        const proposedRow = (mark?.proposed ?? {}) as Record<string, JsonValue>;
                        return (
                          <div
                            key={name}
                            role="cell"
                            data-cell={`${index}:${name}`}
                            data-confidence-tone={review?.cellTranches?.[index]?.[name]?.tone}
                            className="block @table:table-cell align-top @table:py-1 @table:pr-3 mb-2 @table:mb-0"
                          >
                            {name === columns[0] && mark?.kind === 'added' && <span className="block text-2xs font-medium text-status-active">Added</span>}
                            {shown && (
                              <>
                                <span aria-hidden className="@table:hidden block text-2xs font-semibold uppercase tracking-wider text-text-secondary">{cellLabel}</span>
                                <FieldRow
                                  fieldKey={`${fieldKey}.${index}.${name}`}
                                  fieldSchema={cellSchemas[name]}
                                  value={((row ?? {}) as Record<string, JsonValue>)[name] ?? ''}
                                  onChange={(next) => setCell(index, name, next)}
                                  onBlur={onBlur}
                                  isRequired={required.has(name)}
                                  isReadOnly={cell.readOnly === true}
                                  locked={locked}
                                  error={cellError(errors.get(`${index}:${name}`))}
                                  escalationContext={rowCtx as ShowIfContext}
                                />
                                {wasEdited && (
                                  <span className="mt-0.5 flex items-center gap-2 text-2xs text-accent">
                                    <span>Edited · was {formatReviewValue(proposedRow[name], cell, rowCtx)}</span>
                                    {!locked && (
                                      <button type="button" onClick={() => setCell(index, name, proposedRow[name] ?? '')} className="underline-offset-2 hover:underline">
                                        Restore
                                      </button>
                                    )}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                      {!locked && (
                        <div role="cell" className="flex @table:table-cell align-top @table:py-1 gap-0.5 whitespace-nowrap">
                          <RowButton label={`Duplicate ${mark(index)}`} disabled={!canAdd} reason={max !== undefined ? `At most ${max} rows` : undefined} onClick={() => commit(duplicateAt(rows, index))} icon={Copy} />
                          {spec.sortable && <RowButton label={`Move ${mark(index)} up`} disabled={index === 0} onClick={() => commit(moveItem(rows, index, -1))} icon={ArrowUp} />}
                          {spec.sortable && <RowButton label={`Move ${mark(index)} down`} disabled={index === rows.length - 1} onClick={() => commit(moveItem(rows, index, 1))} icon={ArrowDown} />}
                          <RowButton label={`Remove ${mark(index)}`} disabled={!canRemove} reason={min !== undefined ? `At least ${min} rows` : undefined} onClick={() => commit(removeAt(rows, index))} icon={Trash2} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </BareChromeContext.Provider>
      {review?.diff && review.diff.removed.length > 0 && (
        <ul className="mt-2 space-y-0.5" data-testid={`rows-removed-${fieldKey}`}>
          {review.diff.removed.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-2xs text-text-quaternary">
              <s className="truncate">{formatReviewValue([r.item], fieldSchema, context)}</s>
              <span>removed</span>
              {!locked && <button type="button" onClick={() => review.restoreRemoved?.(r)} className="text-accent underline-offset-2 hover:underline">Restore</button>}
            </li>
          ))}
        </ul>
      )}
      {!locked && (
        <button
          type="button"
          onClick={addRow}
          disabled={!canAdd}
          title={!canAdd ? `At most ${max} rows` : undefined}
          data-field-key={rows.length === 0 ? fieldKey : undefined}
          id={rows.length === 0 ? ids.field : undefined}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline underline-offset-2 disabled:text-text-quaternary disabled:no-underline"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />{addLabel}
        </button>
      )}
      <FieldError error={error} id={ids.error} />
    </div>
  );
}

function RowButton({ label, icon: Icon, disabled, reason, onClick }: {
  label: string;
  icon: typeof Copy;
  disabled?: boolean;
  reason?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={disabled && reason ? reason : label}
      className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-hover disabled:text-text-quaternary disabled:hover:bg-transparent"
    >
      <Icon className="w-3.5 h-3.5" strokeWidth={2} />
    </button>
  );
}
