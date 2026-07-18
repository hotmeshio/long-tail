import { getDeep } from '../../../lib/x-lt-bind';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import type { WidgetProps } from './index';

interface ChecklistItem { id: string; label: string }

/**
 * Checklist widget — renders a dynamic list of labeled checkboxes driven by
 * runtime data in the escalation context.
 *
 * Schema usage:
 *   "x-lt-widget": "checklist"
 *   "x-lt-source": "envelope.checklist_items"  (any domain.path works)
 *
 * The source path resolves against the escalation context at render time —
 * use `envelope` for render-only data (no index cost), `metadata` only when
 * the items need to be GIN-indexed and searchable.
 *
 * Value stored in the form: Record<string, boolean> keyed by item id.
 * The workflow receives this as the resolver payload field.
 */
export function ChecklistWidget({
  value,
  onChange,
  schema,
  escalationContext,
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
      <p className="text-xs text-text-tertiary italic mt-1">
        No checklist items. Provide checklist_items in the escalation envelope or metadata.
      </p>
    );
  }

  const checkedCount = items.filter((item) => state[item.id]).length;

  return (
    <div>
      <div className="space-y-2.5 mt-1">
        {items.map((item) => (
          <label key={item.id} className="flex items-start gap-3 cursor-pointer group select-none">
            <input
              type="checkbox"
              checked={state[item.id] ?? false}
              onChange={() => toggle(item.id)}
              className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded accent-accent"
              data-testid={`checklist-item-${item.id}`}
            />
            <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors leading-snug">
              {item.label}
            </span>
          </label>
        ))}
      </div>
      <p className="text-[10px] text-text-quaternary mt-3 tabular-nums">
        {checkedCount} / {items.length} confirmed
      </p>
    </div>
  );
}
