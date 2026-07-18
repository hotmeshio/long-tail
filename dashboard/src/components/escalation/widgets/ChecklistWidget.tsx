import { getDeep } from '../../../lib/x-lt-bind';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import type { WidgetProps } from './index';

interface ChecklistItem { id: string; label: string; required?: boolean }

/**
 * Checklist widget — renders a dynamic list of labeled checkboxes driven by
 * runtime data in the escalation context.
 *
 * Schema usage:
 *   "x-lt-widget": "checklist"
 *   "x-lt-source": "envelope.checklist_items"  (any domain.path works)
 *
 * Item definitions: Array<{ id: string; label: string; required?: boolean }>
 *   required items show an asterisk and highlight in red when unchecked after
 *   a submit attempt — informational, does not block the overall form submit.
 *
 * Field-level required (schema.required includes this key): the widget shows
 *   an error when all items are unchecked and submitAttempted is true.
 *
 * Value stored: Record<string, boolean> keyed by item id.
 */
export function ChecklistWidget({
  value,
  onChange,
  schema,
  escalationContext,
  isRequired,
  submitAttempted,
  error,
}: WidgetProps & { escalationContext?: ShowIfContext }) {
  const sourcePath = schema?.['x-lt-source'] as string | undefined;
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

  if (items.length === 0) {
    return (
      <>
        <p className="text-xs text-text-tertiary italic mt-1">
          No checklist items. Provide checklist_items in the escalation envelope or metadata.
        </p>
        {error && (
          <p className="text-[10px] text-status-error mt-1 animate-[field-error-in_0.3s_ease-out]">
            {error}
          </p>
        )}
      </>
    );
  }

  const checkedCount = items.filter((item) => state[item.id]).length;

  return (
    <div>
      <div className="space-y-2.5 mt-1">
        {items.map((item) => {
          const checked = state[item.id] ?? false;
          // Highlight unchecked items only when ZERO are checked — once any item is
          // confirmed the group requirement is met and all per-item highlights clear.
          const showItemError = !checked && !!submitAttempted && checkedCount === 0 && (item.required || isRequired);
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
              />
              <span className={`text-sm leading-snug transition-colors ${
                showItemError
                  ? 'text-status-error'
                  : 'text-text-secondary group-hover:text-text-primary'
              }`}>
                {item.label}
                {item.required && (
                  <span className={`ml-0.5 text-[10px] ${showItemError ? 'text-status-error' : 'text-text-quaternary'}`}>*</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-[10px] text-text-quaternary mt-3 tabular-nums">
        {checkedCount} / {items.length} confirmed
        {isRequired && checkedCount === 0 && !!submitAttempted && (
          <span className="ml-1 text-text-quaternary/60">(at least one required)</span>
        )}
      </p>
      {error && (
        <p className="text-[10px] text-status-error mt-1 animate-[field-error-in_0.3s_ease-out]">
          {error}
        </p>
      )}
    </div>
  );
}
