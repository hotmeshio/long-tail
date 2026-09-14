import { AlertCircle } from 'lucide-react';
import { deriveFieldLabel } from '../../lib/derive-field-label';
import type { FieldError } from '../../lib/field-validator';

/**
 * The form's issue list. Each row names the field through its schema title
 * and, on click, scrolls to and focuses the input carrying that
 * data-field-key. Shared by the escalation side panel and the invoke panel.
 */
export function ErrorsPanel({ errors, schema }: { errors: FieldError[]; schema?: Record<string, unknown> | null }) {
  const focusField = (field: string) => {
    const el = document.querySelector<HTMLElement>(`[data-field-key="${field}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  };

  if (errors.length === 0) {
    return <p className="text-xs text-text-tertiary italic">No errors to display.</p>;
  }

  return (
    <div className="space-y-1" role="alert" aria-live="polite">
      <p className="text-2xs font-semibold uppercase tracking-wider text-status-error mb-4">
        {errors.length} {errors.length === 1 ? 'issue' : 'issues'} to resolve
      </p>
      <div className="space-y-1.5">
        {errors.map(({ field, message }) => (
          <button
            key={field}
            onClick={() => focusField(field)}
            className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded hover:bg-status-error/5 transition-colors group"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-status-error/60 group-hover:text-status-error transition-colors" />
            <div>
              <p className="text-2xs font-semibold text-text-primary leading-snug">
                {deriveFieldLabel(field, (schema?.properties as Record<string, Record<string, unknown>> | undefined)?.[field])}
              </p>
              <p className="text-2xs text-text-tertiary group-hover:text-text-secondary transition-colors leading-snug mt-0.5">
                {message}
              </p>
            </div>
          </button>
        ))}
      </div>
      <p className="text-2xs text-text-quaternary mt-4 px-3">
        Click an issue to scroll to and focus the field.
      </p>
    </div>
  );
}
