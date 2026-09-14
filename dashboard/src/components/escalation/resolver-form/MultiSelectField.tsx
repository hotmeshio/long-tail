import { Check } from 'lucide-react';
import type { OptionValue, ResolvedOption } from '../../../lib/x-lt-options';
import { FieldLabel, FieldHelper, FieldError } from './FieldChrome';
import type { FieldControlProps } from './field-control-props';
import type { JsonValue } from './form-cells';

/**
 * Pick any from an option list: chips, each a real checkbox. The submitted
 * value is the picked option values in list order. An empty list renders
 * disabled until options arrive.
 */
export function MultiSelectField({ value, options, fieldKey, label, helperText, isRequired, error, onBlur, ids, ariaProps, onChange }: FieldControlProps & {
  value: JsonValue;
  options: ResolvedOption[];
}) {
  const picked = new Set<OptionValue>(Array.isArray(value) ? (value as OptionValue[]) : []);
  const toggle = (v: OptionValue) => {
    const next = new Set(picked);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value) as JsonValue);
    onBlur?.();
  };
  return (
    <div role="group" aria-label={label} aria-required={isRequired || undefined} aria-invalid={error ? true : undefined} aria-describedby={ariaProps['aria-describedby']}>
      <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
      {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
      {options.length === 0 ? (
        <p className="text-xs text-text-tertiary italic mt-1">No options yet</p>
      ) : (
        <div className="flex flex-wrap gap-2 mt-2">
          {options.map((opt, i) => {
            const checked = picked.has(opt.value);
            return (
              <label
                key={String(opt.value)}
                className={`inline-flex items-center gap-1.5 cursor-pointer select-none px-3.5 py-2 text-sm border transition-colors rounded-[var(--lt-radius-field)] ${
                  checked
                    ? 'bg-accent border-accent text-text-inverse'
                    : error
                      ? 'bg-surface-field border-status-error/60 text-status-error'
                      : 'bg-surface-field border-surface-field-border text-text-secondary hover:border-accent hover:text-text-primary'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                  className="sr-only"
                  data-testid={`multi-select-${fieldKey}-${String(opt.value)}`}
                  {...(i === 0 ? { 'data-field-key': fieldKey, id: ids.field } : {})}
                />
                {checked && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />}
                {opt.label}
              </label>
            );
          })}
        </div>
      )}
      <FieldError error={error} id={ids.error} />
    </div>
  );
}
