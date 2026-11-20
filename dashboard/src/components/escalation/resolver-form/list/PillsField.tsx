import { useMemo, useRef, useState } from 'react';
import { FieldLabel, FieldHelper, FieldError } from '../FieldChrome';
import type { FieldControlProps } from '../field-control-props';
import type { JsonValue } from '../form-cells';
import { resolveFieldOptions, type OptionValue, type ResolvedOption } from '../../../../lib/x-lt-options';
import { isNullableType, readListSpec, validateListItems } from '../../../../lib/x-lt-list';
import { Pill, type PillTone } from './Pill';
import { confidenceToneOf, useListReview } from './list-review';
import { formatReviewValue } from '../review-value';
import { useSuggestions } from './use-suggestions';
import { appendItem, asItems, indexOfEqual, moveItem, pillValue, removeAt, replaceAt, splitPaste } from './list-ops';

type Schema = Record<string, any>;

/**
 * A list of scalars as pills: type or paste to add, Backspace to select then
 * remove, arrow keys to walk, Enter to edit in place. With `options` the list
 * is closed (type-ahead picks from them); `x-lt-suggest` offers type-ahead on
 * an open list without limiting it. Every pill is checked against `items`.
 */
export function PillsField({ value, fieldSchema, options, context, fieldKey, label, helperText, isRequired, error, onBlur, ids, ariaProps, onChange, itemTones, locked }: FieldControlProps & {
  value: JsonValue;
  fieldSchema: Schema | undefined;
  options?: ResolvedOption[];
  context?: Record<string, unknown>;
  itemTones?: PillTone[];
  locked?: boolean;
}) {
  const items = asItems(value);
  const spec = readListSpec(fieldSchema);
  const nullable = isNullableType(fieldSchema);
  const closed = options !== undefined;
  const suggestSource = useMemo(
    () => options ?? (spec.suggest ? resolveFieldOptions({ 'x-lt-options': spec.suggest }, context) : undefined),
    [options, spec.suggest, context],
  );
  const labels = useMemo(() => new Map<unknown, string>((suggestSource ?? []).map((o) => [o.value, o.label])), [suggestSource]);
  const taken = useMemo(() => new Set<unknown>(items), [items]);

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const pills = useRef<Array<HTMLSpanElement | null>>([]);
  const input = useRef<HTMLInputElement>(null);
  const suggestions = useSuggestions(suggestSource, draft, taken);
  const review = useListReview();

  const itemErrors = useMemo(() => new Map(validateListItems(items, fieldSchema ?? {}, context).map((e) => [e.index, e.message])), [items, fieldSchema, context]);
  const max = typeof fieldSchema?.maxItems === 'number' ? (fieldSchema.maxItems as number) : undefined;

  const resolveClosed = (text: string): OptionValue | undefined => {
    const wanted = text.trim().toLowerCase();
    return options?.find((o) => String(o.value).toLowerCase() === wanted || o.label.toLowerCase() === wanted)?.value;
  };

  /** The list after adding each text, or the refusal; one change event however many were pasted. */
  const addAll = (texts: string[]): boolean => {
    let next = items;
    let refused = '';
    for (const text of texts) {
      const candidate: JsonValue = closed ? (resolveClosed(text) as JsonValue ?? '') : pillValue(text, fieldSchema);
      if (candidate === '' || candidate === undefined) { refused = closed ? `${text} is not a listed option` : refused; continue; }
      if (fieldSchema?.uniqueItems === true && indexOfEqual(next, candidate) >= 0) { refused = `${text} is already in the list`; continue; }
      if (max !== undefined && next.length >= max) { refused = `At most ${max} item${max === 1 ? '' : 's'}`; break; }
      next = appendItem(next, candidate);
    }
    setNotice(refused);
    if (next !== items) onChange(next);
    return refused === '';
  };

  const commitDraft = () => {
    const text = draft.trim();
    if (text === '') return;
    if (addAll([text])) setDraft('');
    suggestions.reset();
  };

  const pick = (option: ResolvedOption) => {
    if (addAll([String(option.value)])) { setDraft(''); suggestions.reset(); }
  };

  const focusPill = (i: number) => pills.current[i]?.focus();
  const focusInput = () => input.current?.focus();
  const removeAndFocus = (i: number) => { onChange(removeAt(items, i)); if (i > 0) setTimeout(() => focusPill(i - 1), 0); else focusInput(); onBlur?.(); };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const active = suggestions.matches[suggestions.active];
    if (e.key === 'Enter') { if (draft.trim() !== '') { e.preventDefault(); if (active) pick(active); else commitDraft(); } return; }
    if (e.key === 'Tab' && draft.trim() !== '') { e.preventDefault(); if (active) pick(active); else commitDraft(); return; }
    if (e.key === ',') { e.preventDefault(); commitDraft(); return; }
    if (e.key === 'ArrowDown' && suggestions.matches.length > 0) { e.preventDefault(); suggestions.move(1); return; }
    if (e.key === 'ArrowUp' && suggestions.matches.length > 0) { e.preventDefault(); suggestions.move(-1); return; }
    if (e.key === 'Escape') { setDraft(''); suggestions.reset(); return; }
    const atStart = draft === '' && (e.currentTarget.selectionStart ?? 0) === 0;
    if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && atStart && items.length > 0) { e.preventDefault(); focusPill(items.length - 1); }
  };

  const onPillKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (locked) return;
    if (e.altKey && spec.sortable && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      onChange(moveItem(items, i, delta));
      setTimeout(() => focusPill(i + delta), 0);
    } else if (e.key === 'ArrowLeft') { e.preventDefault(); focusPill(Math.max(0, i - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (i >= items.length - 1) focusInput(); else focusPill(i + 1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeAndFocus(i); }
    else if (e.key === 'Enter') { e.preventDefault(); setEditing(i); setDraft(String(items[i])); }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const tokens = splitPaste(e.clipboardData.getData('text'));
    if (tokens.length < 2) return;
    e.preventDefault();
    addAll(tokens);
  };

  const finishEdit = (commit: boolean) => {
    if (editing === null) return;
    const text = draft.trim();
    const index = editing;
    setEditing(null);
    setDraft('');
    if (!commit) return;
    if (text === '') { onChange(removeAt(items, index)); return; }
    const candidate = closed ? (resolveClosed(text) as JsonValue ?? items[index]) : pillValue(text, fieldSchema);
    onChange(replaceAt(items, index, candidate));
    onBlur?.();
  };

  const toneOf = (v: JsonValue, i: number): { tone: PillTone; title?: string; suffix?: string } => {
    const message = itemErrors.get(i);
    if (message) return { tone: 'error', title: message };
    if (closed && !options!.some((o) => o.value === v)) return { tone: 'warning', title: 'Not a known option', suffix: 'not a known option' };
    const mark = review?.diff?.marks[i];
    if (mark?.kind === 'added') return { tone: 'added', title: 'Added' };
    if (mark?.kind === 'edited') {
      const was = formatReviewValue(mark.proposed, fieldSchema, context);
      return { tone: 'edited', title: `Proposed: ${was}`, suffix: `was ${was}` };
    }
    return { tone: itemTones?.[i] ?? 'default' };
  };

  return (
    <div role="group" aria-label={label} aria-required={isRequired || undefined} aria-invalid={error ? true : undefined} aria-describedby={ariaProps['aria-describedby']}>
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel isRequired={isRequired} htmlFor={ids.field}>{label}</FieldLabel>
        {nullable && items.length > 0 && !locked && (
          <button type="button" onClick={() => { onChange(null); onBlur?.(); }} className="text-2xs text-text-tertiary hover:text-accent underline-offset-2 hover:underline">
            Clear to &ldquo;not stated&rdquo;
          </button>
        )}
      </div>
      {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
      <div
        data-field-box
        className={`relative mt-1 flex flex-wrap items-center gap-1.5 px-2 py-1.5 min-h-9 bg-surface-field border rounded-[var(--lt-radius-field)] ${error ? 'border-status-error/50' : 'border-surface-field-border'} focus-within:border-accent`}
        onClick={() => { if (!locked) focusInput(); }}
      >
        <div role="list" className="contents">
          {items.map((v, i) => {
            if (editing === i) {
              return (
                <input
                  key={`edit-${i}`}
                  autoFocus
                  value={draft}
                  aria-label={`Edit ${String(v)}`}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); } else if (e.key === 'Escape') finishEdit(false); }}
                  onBlur={() => finishEdit(true)}
                  className="bg-transparent outline-none text-xs font-mono w-28 border-b border-accent"
                />
              );
            }
            const t = toneOf(v, i);
            const text = closed ? labels.get(v as OptionValue) ?? String(v) : String(v);
            return (
              <Pill
                key={`${String(v)}-${i}`}
                ref={(el) => { pills.current[i] = el; }}
                text={text}
                {...t}
                locked={locked}
                confidence={confidenceToneOf(review?.itemTranches?.[i])}
                onRemove={() => removeAndFocus(i)}
                onKeyDown={onPillKeyDown(i)}
                onDoubleClick={() => { if (!locked) { setEditing(i); setDraft(String(v)); } }}
              />
            );
          })}
          {review?.diff?.removed.map((r, i) => (
            <Pill
              key={`removed-${i}`}
              text={closed ? labels.get(r.item as OptionValue) ?? String(r.item) : formatReviewValue(r.item, fieldSchema, context)}
              tone="removed"
              suffix="removed"
              onRestore={locked ? undefined : () => review.restoreRemoved?.(r)}
            />
          ))}
        </div>
        {!locked && (
          <input
            ref={input}
            id={ids.field}
            data-field-key={fieldKey}
            value={editing === null ? draft : ''}
            disabled={editing !== null}
            placeholder={items.length === 0 ? (value === null ? 'Not stated' : closed ? 'Type to add' : 'Type, then Enter') : ''}
            onChange={(e) => { setDraft(e.target.value); setNotice(''); suggestions.reset(); }}
            onKeyDown={onInputKeyDown}
            onPaste={onPaste}
            onBlur={() => { commitDraft(); onBlur?.(); }}
            role="combobox"
            aria-expanded={suggestions.matches.length > 0}
            aria-controls={`${ids.field}-suggestions`}
            aria-autocomplete="list"
            aria-activedescendant={suggestions.active >= 0 ? `${ids.field}-opt-${suggestions.active}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={ariaProps['aria-describedby']}
            className="flex-1 min-w-24 bg-transparent outline-none text-sm placeholder:italic placeholder:text-text-tertiary"
          />
        )}
        {suggestions.matches.length > 0 && (
          <ul id={`${ids.field}-suggestions`} role="listbox" className="absolute left-0 top-full mt-1 z-20 min-w-full max-h-56 overflow-y-auto bg-surface-field border border-surface-field-border rounded-[var(--lt-radius-field)] py-1 text-sm">
            {suggestions.matches.map((o, i) => (
              <li
                key={String(o.value)}
                id={`${ids.field}-opt-${i}`}
                role="option"
                aria-selected={i === suggestions.active}
                onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                className={`px-3 py-1 cursor-pointer ${i === suggestions.active ? 'bg-surface-hover text-text-primary' : 'text-text-secondary'}`}
              >
                <span className="font-mono text-xs">{String(o.value)}</span>
                {o.label !== String(o.value) && <span className="ml-2 text-text-tertiary">{o.label}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p role="status" aria-live="polite" className={notice ? 'text-2xs text-status-warning mt-1' : 'sr-only'}>{notice}</p>
      <FieldError error={error} id={ids.error} />
    </div>
  );
}
