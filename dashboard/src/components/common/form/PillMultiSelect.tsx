import { X } from 'lucide-react';

/**
 * Multi-select as removable pills plus an "Add…" select of the remaining
 * options. Wraps to any width, so it holds up in narrow panels — the standard
 * control for "pick several from a known set" (queue targeting, role scoping).
 */
export function PillMultiSelect({
  values,
  options,
  onChange,
  addLabel,
  emptyText,
  ariaLabel,
}: {
  values: string[];
  options: string[];
  onChange: (next: string[]) => void;
  /** The add select's placeholder (e.g. "Add a queue…"). */
  addLabel: string;
  /** Italic hint shown while nothing is selected (e.g. "Everyone"). */
  emptyText?: string;
  ariaLabel?: string;
}) {
  const remaining = options.filter((o) => !values.includes(o));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(values.filter((x) => x !== v))}
          className="inline-flex items-center gap-1 text-2xs font-mono text-text-primary border border-surface-border px-1.5 py-0.5 hover:text-status-error hover:border-status-error/50 transition-colors"
          title={`Remove ${v}`}
        >
          {v}
          <X className="w-3 h-3" strokeWidth={1.5} />
        </button>
      ))}
      {values.length === 0 && emptyText && (
        <span className="text-2xs text-text-tertiary italic">{emptyText}</span>
      )}
      {remaining.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && onChange([...values, e.target.value])}
          className="select font-mono"
          aria-label={ariaLabel ?? addLabel}
        >
          <option value="">{addLabel}</option>
          {remaining.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </div>
  );
}
