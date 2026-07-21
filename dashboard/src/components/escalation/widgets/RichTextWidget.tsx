interface RichTextWidgetProps {
  fieldKey: string;
  value: string;
  onChange: (v: string) => void;
  schema?: Record<string, unknown>;
}

/**
 * Rich text input — a tall textarea with formatting hints.
 * A full WYSIWYG editor can replace this in a future iteration.
 */
export function RichTextWidget({ fieldKey, value, onChange, schema }: RichTextWidgetProps) {
  const label = fieldKey.replace(/[_-]/g, ' ');
  const helperText = schema?.description as string | undefined;

  return (
    <div>
      <label className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
        {label}
      </label>
      {helperText && <p className="text-2xs text-text-tertiary mt-0.5">{helperText}</p>}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full mt-1 text-sm leading-relaxed"
        rows={8}
        placeholder="Supports plain text. Markdown formatting is preserved."
      />
    </div>
  );
}
