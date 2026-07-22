import { deriveFieldLabel } from '../../../lib/derive-field-label';
import { FieldLabel } from '../resolver-form/FieldChrome';

interface RichTextWidgetProps {
  fieldKey: string;
  value: string;
  onChange: (v: string) => void;
  schema?: Record<string, unknown>;
  isRequired?: boolean;
}

/**
 * Rich text input — a tall textarea with formatting hints.
 * A full WYSIWYG editor can replace this in a future iteration.
 */
export function RichTextWidget({ fieldKey, value, onChange, schema, isRequired }: RichTextWidgetProps) {
  const label = deriveFieldLabel(fieldKey, schema);
  const helperText = schema?.description as string | undefined;

  return (
    <div>
      <FieldLabel isRequired={isRequired}>
        {label}
      </FieldLabel>
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
