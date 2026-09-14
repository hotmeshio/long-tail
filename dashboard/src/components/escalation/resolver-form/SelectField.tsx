import type { ResolvedOption } from '../../../lib/x-lt-options';
import { FieldLabel, FieldHelper, FieldError, selectClass } from './FieldChrome';
import type { FieldControlProps } from './field-control-props';
import type { JsonValue } from './form-cells';

/**
 * One choice from an option list. The submitted answer is the option VALUE
 * with its own type (a numeric or boolean option stays so). A value outside
 * the list shows the disabled Choose placeholder, and once a value is picked
 * there is no way back. With `x-lt-nullable` the placeholder stays enabled
 * and picking it submits null. An empty list (a cascade child whose parent
 * is unanswered) renders disabled until options arrive.
 */
export function SelectField({ value, options, nullable, fieldKey, label, helperText, isRequired, error, onBlur, ids, ariaProps, onChange }: FieldControlProps & {
  value: JsonValue;
  options: ResolvedOption[];
  nullable?: boolean;
}) {
  const current = value === null || value === undefined || value === '' ? '' : String(value);
  const hasCurrent = options.some((opt) => String(opt.value) === current);
  return (
    <div>
      <FieldLabel isRequired={isRequired} htmlFor={ids.field}>{label}</FieldLabel>
      {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
      <select
        value={hasCurrent ? current : ''}
        disabled={options.length === 0}
        onChange={(e) => {
          const picked = options.find((opt) => String(opt.value) === e.target.value);
          onChange(picked ? picked.value : null);
          onBlur?.();
        }}
        onBlur={onBlur}
        data-field-key={fieldKey}
        className={selectClass(!!error)}
        {...ariaProps}
      >
        {(!hasCurrent || nullable) && <option value="" disabled={!nullable}>Choose…</option>}
        {options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
        ))}
      </select>
      <FieldError error={error} id={ids.error} />
    </div>
  );
}
