import { TEXTAREA_WIDGET } from '../widgets/field-widgets';
import { resolveCtxPath } from '../../../lib/ctx-path';
import { useContext } from 'react';
import { FieldLabel, FieldHelper, FieldError, BareChromeContext, inputClass } from './FieldChrome';
import type { JsonValue } from './form-cells';
import type { FieldControlProps } from './field-control-props';
import { FieldNoticeLine, type FieldNotice } from './field-notice';

const FORMAT_INPUT_TYPES: Record<string, string> = {
  date: 'date',
  'date-time': 'datetime-local',
  email: 'email',
  uri: 'url',
};
const FORMAT_WIDTH: Record<string, string> = {
  date: 'max-w-48',
  'date-time': 'max-w-64',
};

export type ScalarKind = 'boolean' | 'number' | 'integer' | 'string';

/**
 * The single-value controls: a checkbox, a number, and every text shape
 * (password, date, email, link, textarea, plain). The control follows the
 * declared type and format; the stored value only fills it.
 */
export function ScalarControl({ kind, value, fieldSchema, context, notice, control }: {
  kind: ScalarKind;
  value: JsonValue;
  fieldSchema: Record<string, any> | undefined;
  context: Record<string, unknown> | undefined;
  notice: FieldNotice | null;
  control: FieldControlProps;
}) {
  const { fieldKey, label, helperText, isRequired, error, onBlur, ids, ariaProps, onChange } = control;
  const fieldId = ids.field;
  const inCell = useContext(BareChromeContext);

  if (kind === 'boolean') {
    return (
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => { onChange(e.target.checked); onBlur?.(); }}
            className="w-3.5 h-3.5 rounded accent-accent"
            data-field-key={fieldKey}
            {...ariaProps}
          />
          <span className="text-2xs font-semibold uppercase tracking-wider text-text-secondary">
            {label}
            {isRequired && <span className="text-status-error ml-0.5">*</span>}
          </span>
        </label>
        {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
        <FieldError error={error} id={ids.error} />
      </div>
    );
  }

  if (kind === 'number' || kind === 'integer') {
    // Numbers are short; the input holds a hand-sized width.
    return (
      <div>
        <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
        {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
        <input
          type="number"
          value={typeof value === 'number' || typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(inCell && e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
          onBlur={onBlur}
          step="any"
          data-field-key={fieldKey}
          className={`${inputClass(!!error)} max-w-48`}
          {...ariaProps}
        />
        <FieldError error={error} id={ids.error} />
      </div>
    );
  }

  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  const format = fieldSchema?.format as string | undefined;
  const chrome = (input: React.ReactNode, after?: React.ReactNode) => (
    <div>
      <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
      {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
      {input}
      {after}
      <FieldError error={error} id={ids.error} />
    </div>
  );

  if (format === 'password') {
    return chrome(
      <input
        type="password"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        data-field-key={fieldKey}
        className={inputClass(!!error)}
        autoComplete="off"
        {...ariaProps}
      />,
    );
  }

  // Emails and urls fill the cell; dates hold a hand-sized width, like numbers.
  if (format && format in FORMAT_INPUT_TYPES) {
    return chrome(
      <input
        type={FORMAT_INPUT_TYPES[format]}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        data-field-key={fieldKey}
        className={`${inputClass(!!error)} ${FORMAT_WIDTH[format] ?? ''}`}
        {...ariaProps}
      />,
    );
  }

  // A declared textarea, multi-line text, or long content.
  if (format === 'textarea' || fieldSchema?.['x-lt-widget'] === TEXTAREA_WIDGET || text.includes('\n') || text.length > 80) {
    const staticMax = fieldSchema?.maxLength as number | undefined;
    const dynamicMax = fieldSchema?.['x-lt-max-length'] as string | undefined;
    const dynamicValue = dynamicMax ? Number(resolveCtxPath(dynamicMax, context)) : NaN;
    const resolvedMax = staticMax ?? (Number.isFinite(dynamicValue) ? dynamicValue : undefined);
    const isOverMax = resolvedMax !== undefined && text.length > resolvedMax;
    return chrome(
      <textarea
        value={text}
        onChange={(e) => { onChange(e.target.value); onBlur?.(); }}
        onBlur={onBlur}
        data-field-key={fieldKey}
        className={`${inputClass(!!error)} leading-relaxed`}
        rows={Math.min(6, Math.max(3, Math.ceil(text.length / 60)))}
        {...ariaProps}
      />,
      resolvedMax !== undefined && (
        <p className={`text-2xs mt-0.5 text-right tabular-nums ${isOverMax ? 'text-status-error font-medium' : 'text-text-quaternary'}`}>
          {text.length} / {resolvedMax}
        </p>
      ),
    );
  }

  return (
    <div>
      <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
      {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
      <input
        type="text"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        data-field-key={fieldKey}
        className={inputClass(!!error)}
        {...ariaProps}
      />
      <FieldError error={error} id={ids.error} />
      <FieldNoticeLine notice={notice} />
    </div>
  );
}
