import type { JsonValue } from './form-cells';

/** The chrome every control shares: label, instruction, error, and the aria wiring FieldRow derives. */
export interface FieldControlProps {
  fieldKey: string;
  label: string;
  helperText?: string;
  isRequired?: boolean;
  error?: string;
  onBlur?: () => void;
  ids: { field: string; help: string; error: string };
  ariaProps: {
    id: string;
    'aria-required'?: true;
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  };
  onChange: (v: JsonValue) => void;
}
