import { useEffect, useState } from 'react';
import { FieldLabel, FieldHelper, FieldError, inputClass } from './FieldChrome';
import type { FieldControlProps } from './field-control-props';
import type { JsonValue } from './form-cells';

function pretty(value: JsonValue): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

function parse(text: string): { ok: true; value: JsonValue } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as JsonValue };
  } catch {
    return { ok: false };
  }
}

/**
 * Raw JSON for a list or map field. The text lives here while it is edited;
 * a valid parse emits the parsed value, empty text emits null, and text that
 * does not parse is emitted as-is so the shared pass reports Invalid JSON.
 * Typing never reformats; an outside change to the value resyncs the text.
 */
export function JsonField({ value, fieldKey, label, helperText, isRequired, error, onBlur, ids, ariaProps, onChange }: FieldControlProps & {
  value: JsonValue;
}) {
  const [text, setText] = useState(() => pretty(value));

  useEffect(() => {
    if (typeof value === 'string') {
      if (value !== text) setText(value);
      return;
    }
    const parsed = parse(text);
    const same = parsed.ok && JSON.stringify(parsed.value) === JSON.stringify(value ?? null);
    if (!same && !(text.trim() === '' && value === null)) setText(pretty(value));
    // Resync only follows the value; the text is the source while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const lines = text.split('\n').length;
  return (
    <div>
      <FieldLabel isRequired={isRequired} htmlFor={ids.field}>{label}</FieldLabel>
      {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
      <textarea
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (next.trim() === '') { onChange(null); return; }
          const parsed = parse(next);
          onChange(parsed.ok ? parsed.value : next);
        }}
        onBlur={onBlur}
        spellCheck={false}
        data-field-key={fieldKey}
        rows={Math.min(14, Math.max(4, lines))}
        className={`${inputClass(!!error)} font-mono text-xs leading-relaxed`}
        {...ariaProps}
      />
      <FieldError error={error} id={ids.error} />
    </div>
  );
}
