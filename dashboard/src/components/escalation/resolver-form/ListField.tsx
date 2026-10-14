import { X } from 'lucide-react';
import { readScanSink, scanTargetCount } from '../../../lib/x-lt-scan';
import { FieldLabel, FieldHelper, FieldError } from './FieldChrome';
import { FieldNoticeLine, type FieldNotice } from './field-notice';
import type { JsonValue } from './form-cells';

/**
 * A list field without an option list. A scan field is a checklist: its
 * instruction while empty, `n of N` against what it expects (or maxItems),
 * and a remove control on each value while the form is editable. Any other
 * list displays its values.
 */
export function ListField({ fieldKey, label, values, fieldSchema, helperText, isRequired, error, ids, notice, context, onChange }: {
  fieldKey: string;
  label: string;
  values: JsonValue[];
  fieldSchema?: Record<string, unknown>;
  helperText?: string;
  isRequired?: boolean;
  error?: string;
  ids: { help: string; error: string };
  notice: FieldNotice | null;
  context?: Record<string, unknown>;
  onChange: (v: JsonValue) => void;
}) {
  const sink = readScanSink(fieldSchema);
  const target = sink ? scanTargetCount(fieldSchema, context) : null;
  const prompt = sink?.prompt ?? helperText;
  const remove = (index: number) => onChange(values.filter((_, i) => i !== index));

  return (
    <div data-field-key={fieldKey} tabIndex={sink ? -1 : undefined} className="outline-none">
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
        {target !== null && (
          <span className="text-2xs tabular-nums text-text-tertiary" data-testid="list-field-count">
            {values.length} of {target}
          </span>
        )}
      </div>
      {helperText && (values.length > 0 || !sink) && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
      {values.length === 0 && sink ? (
        <p id={ids.help} className="text-xs text-text-tertiary mt-1 italic" data-testid="list-field-empty">
          {prompt ?? 'Scan to add'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {values.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-2xs font-mono bg-surface-sunken rounded text-text-secondary">
              {String(item)}
              {sink && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="-mr-1 p-0.5 rounded text-text-quaternary hover:text-status-error hover:bg-surface-hover"
                  aria-label={`Remove ${String(item)}`}
                  data-testid="list-field-remove"
                >
                  <X className="w-3 h-3" strokeWidth={2} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <FieldError error={error} id={ids.error} />
      <FieldNoticeLine notice={notice} />
    </div>
  );
}
