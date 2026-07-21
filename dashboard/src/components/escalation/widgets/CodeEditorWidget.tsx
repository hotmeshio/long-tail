import { useCallback } from 'react';

interface CodeEditorWidgetProps {
  fieldKey: string;
  value: string;
  onChange: (v: string) => void;
  schema?: Record<string, unknown>;
}

/**
 * Monospace textarea with tab-key support for code input.
 */
export function CodeEditorWidget({ fieldKey, value, onChange, schema }: CodeEditorWidgetProps) {
  const label = fieldKey.replace(/[_-]/g, ' ');
  const helperText = schema?.description as string | undefined;
  const language = (schema?.['x-lt-language'] as string) ?? '';

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const updated = value.substring(0, start) + '  ' + value.substring(end);
      onChange(updated);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  }, [value, onChange]);

  return (
    <div>
      <label className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
        {label}
        {language && (
          <span className="ml-2 text-text-tertiary/60 normal-case font-normal">{language}</span>
        )}
      </label>
      {helperText && <p className="text-2xs text-text-tertiary mt-0.5">{helperText}</p>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="input w-full mt-1 font-mono text-xs leading-relaxed"
        rows={10}
        spellCheck={false}
      />
    </div>
  );
}
