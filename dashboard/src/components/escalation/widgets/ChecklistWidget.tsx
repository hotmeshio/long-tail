import { Check } from 'lucide-react';

import { getDeep } from '../../../lib/x-lt-bind';
import { deriveFieldLabel } from '../../../lib/derive-field-label';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import { FieldLabel, FieldHelper } from '../resolver-form/FieldChrome';
import type { WidgetProps } from './index';

interface ChecklistItem { id: string; label: string; required?: boolean }

/** Labels at or under this length read as tags; longer ones read as sentences. */
const CHIP_LABEL_MAX = 28;

/**
 * Checklist widget — a dynamic list of labeled checkboxes driven by runtime
 * data in the escalation context.
 *
 * Schema usage:
 *   "x-lt-widget": "checklist"
 *   "x-lt-source": "envelope.checklist_items"  (any domain.path works)
 *   "x-lt-variant": "chips" | "rows"           (optional; see geometry below)
 *
 * Item definitions: Array<{ id: string; label: string; required?: boolean }>
 *
 * GEOMETRY — item length and selection mode decide it:
 *   - rows  — one item per line. The shape for rituals: sentence-length
 *     confirmations read top-down and are ticked deliberately.
 *     `x-lt-require-all` always renders rows.
 *   - chips — a wrapping cloud of selectable pills. The shape for tags:
 *     short pick-any items (reject reasons, categories) flow horizontally,
 *     thumb-sized, selection visible at a glance.
 *   Explicit `x-lt-variant` wins; otherwise require-all → rows, else chips
 *   when every label is ≤28 characters.
 *
 * "x-lt-require-all": true — completion guard: every item must be checked
 *   before submission, except items whose definition carries required: false.
 *
 * Value stored: Record<string, boolean> keyed by item id.
 */
export function ChecklistWidget({
  fieldKey,
  value,
  onChange,
  schema,
  escalationContext,
  isRequired,
  submitAttempted,
  error,
}: WidgetProps & { escalationContext?: ShowIfContext }) {
  const sourcePath = schema?.['x-lt-source'] as string | undefined;
  const requireAll = schema?.['x-lt-require-all'] === true;
  const items: ChecklistItem[] = [];

  if (sourcePath && escalationContext) {
    const dot = sourcePath.indexOf('.');
    if (dot !== -1) {
      const domain = sourcePath.slice(0, dot) as keyof ShowIfContext;
      const path = sourcePath.slice(dot + 1);
      try {
        const raw = getDeep(escalationContext[domain] as unknown, path);
        if (Array.isArray(raw)) items.push(...(raw as ChecklistItem[]));
      } catch { /* ignore bad source path */ }
    }
  }

  let state: Record<string, boolean> = {};
  try { if (value) state = JSON.parse(value) as Record<string, boolean>; } catch { /* start empty */ }

  const toggle = (id: string) => onChange(JSON.stringify({ ...state, [id]: !state[id] }));

  const title = deriveFieldLabel(fieldKey, schema);
  const helperText = schema?.description as string | undefined;

  if (items.length === 0) {
    return (
      <>
        <p className="text-xs text-text-tertiary italic mt-1">
          No checklist items. Provide checklist_items in the escalation envelope or metadata.
        </p>
        {error && (
          <p className="text-2xs text-status-error mt-1 animate-[field-error-in_0.3s_ease-out]">
            {error}
          </p>
        )}
      </>
    );
  }

  const explicitVariant = schema?.['x-lt-variant'] as string | undefined;
  const variant = explicitVariant === 'chips' || explicitVariant === 'rows'
    ? explicitVariant
    : requireAll || items.some((i) => i.label.length > CHIP_LABEL_MAX)
      ? 'rows'
      : 'chips';

  const checkedCount = items.filter((item) => state[item.id]).length;
  // The click-to-focus anchor: the first unchecked mandatory item, so the
  // error panel lands the user on the next box to tick (first item when done).
  const focusId = (items.find((i) => !state[i.id] && i.required !== false) ?? items[0]).id;

  return (
    <div role="group" aria-label={title} aria-required={isRequired || undefined} aria-invalid={error ? true : undefined}>
      <FieldLabel isRequired={isRequired}>{title}</FieldLabel>
      {helperText && <FieldHelper>{helperText}</FieldHelper>}
      {variant === 'chips' ? (
        <div className="flex flex-wrap gap-2 mt-2">
          {items.map((item) => {
            const checked = state[item.id] ?? false;
            const showItemError = !checked && !!submitAttempted && checkedCount === 0 && (item.required || isRequired);
            return (
              // The pill IS the checkbox: the real input stays in the label
              // (sr-only) so native semantics and the focus anchor survive.
              // Selection is an act — it earns the solid accent.
              <label
                key={item.id}
                className={`inline-flex items-center gap-1.5 cursor-pointer select-none px-3.5 py-2 text-sm border transition-colors rounded-[var(--lt-radius-field)] ${
                  checked
                    ? 'bg-accent border-accent text-text-inverse'
                    : showItemError
                      ? 'bg-surface-field border-status-error/60 text-status-error'
                      : 'bg-surface-field border-surface-field-border text-text-secondary hover:border-accent hover:text-text-primary'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item.id)}
                  className="sr-only"
                  data-testid={`checklist-item-${item.id}`}
                  {...(item.id === focusId ? { 'data-field-key': fieldKey } : {})}
                />
                {checked && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />}
                {item.label}
              </label>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2.5 mt-2">
          {items.map((item) => {
            const checked = state[item.id] ?? false;
            // require-all: every unchecked mandatory item (required !== false) is an
            // error after a submit attempt, clearing live as each is checked.
            // At-least-one mode: highlight only while ZERO are checked — once any
            // item is confirmed the group requirement is met and highlights clear.
            const showItemError = !checked && !!submitAttempted && (
              requireAll
                ? item.required !== false
                : checkedCount === 0 && (item.required || isRequired)
            );
            return (
              <label
                key={item.id}
                className={`flex items-start gap-3 cursor-pointer group select-none rounded px-2 py-1 -mx-2 transition-colors ${
                  showItemError ? 'bg-status-error/5' : 'hover:bg-surface-hover'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item.id)}
                  className={`mt-0.5 w-3.5 h-3.5 shrink-0 rounded ${showItemError ? 'accent-status-error' : 'accent-accent'}`}
                  data-testid={`checklist-item-${item.id}`}
                  {...(item.id === focusId ? { 'data-field-key': fieldKey } : {})}
                />
                <span className={`text-sm leading-snug transition-colors ${
                  showItemError
                    ? 'text-status-error'
                    : 'text-text-secondary group-hover:text-text-primary'
                }`}>
                  {item.label}
                  {item.required && (
                    <span className={`ml-0.5 text-2xs ${showItemError ? 'text-status-error' : 'text-text-quaternary'}`}>*</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <p className="text-2xs text-text-quaternary mt-3 tabular-nums">
        {variant === 'chips' ? (
          <>
            {checkedCount} selected
            {isRequired && checkedCount === 0 && !!submitAttempted && (
              <span className="ml-1 text-text-quaternary/60">(check at least one)</span>
            )}
          </>
        ) : (
          <>
            {checkedCount} / {items.length} confirmed
            {requireAll ? (
              <span className="ml-1 text-text-quaternary/60">
                (all required{items.some((i) => i.required === false) ? ' except optional' : ''})
              </span>
            ) : isRequired && checkedCount === 0 && !!submitAttempted && (
              <span className="ml-1 text-text-quaternary/60">(at least one required)</span>
            )}
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="text-2xs text-status-error mt-1 animate-[field-error-in_0.3s_ease-out]">
          {error}
        </p>
      )}
    </div>
  );
}
