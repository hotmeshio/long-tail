import { WIDGET_MAP } from '../widgets';
import { type ShowIfContext } from '../../../lib/x-lt-show-if';
import { resolveFieldOptions } from '../../../lib/x-lt-options';
import { resolveCtxPath } from '../../../lib/ctx-path';
import { deriveFieldLabel } from '../../../lib/derive-field-label';
import { FieldLabel, FieldHelper, FieldError, inputClass } from './FieldChrome';
import { declaredKind, type JsonValue } from './form-cells';
import type { FieldControlProps } from './field-control-props';
import { SelectField } from './SelectField';
import { MultiSelectField } from './MultiSelectField';
import { JsonField } from './JsonField';

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

/**
 * Field row: the control follows the field's declared `type` and its tokens;
 * the stored value only fills it. The `data-field-key` attribute and
 * `lt-field-*` ids are load-bearing: the errors panel scroll-and-focus and
 * the test suite target them.
 */
export function FieldRow({ fieldKey, value, onChange, onBlur, schema, isRequired, isReadOnly, error, escalationContext, submitAttempted }: {
  fieldKey: string;
  value: JsonValue;
  onChange: (v: JsonValue) => void;
  onBlur?: () => void;
  schema?: Record<string, any> | null;
  isRequired?: boolean;
  isReadOnly?: boolean;
  error?: string;
  escalationContext?: ShowIfContext;
  submitAttempted?: boolean;
}) {
  const fieldSchema = schema?.properties?.[fieldKey] as Record<string, any> | undefined;
  const label = deriveFieldLabel(fieldKey, fieldSchema);
  const widgetName = fieldSchema?.['x-lt-widget'] as string | undefined;
  const kind = declaredKind(fieldSchema, value);

  const fieldId = `lt-field-${fieldKey}`;
  const ids = { field: fieldId, help: `${fieldId}-help`, error: `${fieldId}-error` };
  const helperText = typeof fieldSchema?.description === 'string' && fieldSchema.description.length > 0
    ? fieldSchema.description
    : undefined;
  const ariaProps = {
    id: fieldId,
    'aria-required': isRequired || undefined,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? ids.error : helperText ? ids.help : undefined,
  } as const;
  const control: FieldControlProps = { fieldKey, label, helperText, isRequired, error, onBlur, ids, ariaProps, onChange };

  // Content and embed widgets render even when readOnly; everything else reads as static text.
  const isMarkdown = widgetName === 'markdown' && typeof value === 'string';
  const isAttachment = (widgetName === 'attachment' || widgetName === 'image') && typeof value === 'string';
  const hasRegisteredWidget = !!(widgetName && widgetName in WIDGET_MAP);

  if (isReadOnly && !isMarkdown && !isAttachment && !hasRegisteredWidget) {
    const displayValue = value === null ? 'null'
      : typeof value === 'object' ? JSON.stringify(value, null, 2)
      : String(value);
    return (
      <div>
        <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
        <p className="text-sm text-text-secondary mt-0.5 whitespace-pre-wrap">{displayValue}</p>
      </div>
    );
  }

  if (widgetName === 'json' && (kind === 'array' || kind === 'object')) {
    return <JsonField {...control} value={value} />;
  }

  // The widget interface deals in strings; FieldRow owns the object/string
  // boundary by DECLARED type, so a stray string value heals on the next edit.
  if (widgetName && widgetName in WIDGET_MAP) {
    const Widget = WIDGET_MAP[widgetName];
    const widgetRequired = isRequired || fieldSchema?.['x-lt-require-all'] === true;
    const widgetProps = { fieldKey, schema: fieldSchema, escalationContext, isRequired: widgetRequired, submitAttempted, error };
    if (fieldSchema?.type === 'object') {
      const raw = typeof value === 'string'
        ? value
        : typeof value === 'object' && value !== null && !Array.isArray(value)
          ? JSON.stringify(value)
          : '';
      return (
        <Widget
          {...widgetProps}
          value={raw}
          onChange={(next) => { try { onChange(JSON.parse(next) as JsonValue); } catch { onChange(next); } }}
        />
      );
    }
    if (typeof value === 'string') {
      return <Widget {...widgetProps} value={value} onChange={(v) => onChange(v)} />;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return (
        <Widget
          {...widgetProps}
          value={JSON.stringify(value)}
          onChange={(raw) => { try { onChange(JSON.parse(raw) as JsonValue); } catch { onChange(raw); } }}
        />
      );
    }
  }

  // Option lists: the static enum, an inline literal list, or a context path.
  // A list field becomes a multi-select only through its own x-lt-options. An
  // interpolated list that resolves to nothing yet renders disabled and
  // populates when the parent answer lands.
  const options = resolveFieldOptions(fieldSchema, escalationContext as Record<string, unknown> | undefined);
  if (kind === 'array') {
    if (options !== undefined && fieldSchema?.['x-lt-options'] !== undefined) {
      return <MultiSelectField {...control} value={value} options={options} />;
    }
  } else if (options !== undefined && kind !== 'object') {
    return <SelectField {...control} value={value} options={options} nullable={fieldSchema?.['x-lt-nullable'] === true} />;
  }

  switch (kind) {
    case 'boolean':
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

    case 'number':
    case 'integer':
      // Numbers are short; the input holds a hand-sized width.
      return (
        <div>
          <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
          {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
          <input
            type="number"
            value={typeof value === 'number' || typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            onBlur={onBlur}
            step="any"
            data-field-key={fieldKey}
            className={`${inputClass(!!error)} max-w-48`}
            {...ariaProps}
          />
          <FieldError error={error} id={ids.error} />
        </div>
      );

    case 'string':
      return renderText(typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));

    case 'array':
      // Without an option list or the json widget a list is display only.
      if (!Array.isArray(value)) return renderText(value === null || value === undefined ? '' : String(value));
      return (
        <div>
          <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {value.map((item, i) => (
              <span key={i} className="px-2 py-0.5 text-2xs font-mono bg-surface-sunken rounded text-text-secondary">
                {String(item)}
              </span>
            ))}
          </div>
        </div>
      );

    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return renderText(value === null || value === undefined ? '' : String(value));
      }
      const entries = Object.entries(value);
      return (
        <div>
          <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
          <div className="ml-4 mt-2 pl-4 border-l border-accent-faint space-y-3">
            {entries.map(([k, v]) => (
              <FieldRow
                key={k}
                fieldKey={k}
                value={v}
                onChange={(updated) => onChange({ ...value, [k]: updated })}
              />
            ))}
          </div>
        </div>
      );
    }

    default:
      return (
        <div>
          <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
          <p className="text-xs text-text-tertiary italic mt-1">null</p>
        </div>
      );
  }

  function renderText(text: string) {
    const format = fieldSchema?.format as string | undefined;

    if (format === 'password') {
      return (
        <div>
          <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
          {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
          <input
            type="password"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            data-field-key={fieldKey}
            className={inputClass(!!error)}
            autoComplete="off"
            {...ariaProps}
          />
          <FieldError error={error} id={ids.error} />
        </div>
      );
    }

    // Emails and urls fill the cell; dates hold a hand-sized width, like numbers.
    if (format && format in FORMAT_INPUT_TYPES) {
      return (
        <div>
          <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
          {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
          <input
            type={FORMAT_INPUT_TYPES[format]}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            data-field-key={fieldKey}
            className={`${inputClass(!!error)} ${FORMAT_WIDTH[format] ?? ''}`}
            {...ariaProps}
          />
          <FieldError error={error} id={ids.error} />
        </div>
      );
    }

    // Explicit textarea format or long content.
    if (format === 'textarea' || text.length > 80) {
      const staticMax = fieldSchema?.maxLength as number | undefined;
      const dynamicMax = fieldSchema?.['x-lt-max-length'] as string | undefined;
      const dynamicValue = dynamicMax ? Number(resolveCtxPath(dynamicMax, escalationContext as Record<string, unknown> | undefined)) : NaN;
      const resolvedMax = staticMax ?? (Number.isFinite(dynamicValue) ? dynamicValue : undefined);
      const isOverMax = resolvedMax !== undefined && text.length > resolvedMax;
      return (
        <div>
          <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
          {helperText && <FieldHelper id={ids.help}>{helperText}</FieldHelper>}
          <textarea
            value={text}
            onChange={(e) => { onChange(e.target.value); onBlur?.(); }}
            onBlur={onBlur}
            data-field-key={fieldKey}
            className={`${inputClass(!!error)} leading-relaxed`}
            rows={Math.min(6, Math.max(3, Math.ceil(text.length / 60)))}
            {...ariaProps}
          />
          {resolvedMax !== undefined && (
            <p className={`text-2xs mt-0.5 text-right tabular-nums ${isOverMax ? 'text-status-error font-medium' : 'text-text-quaternary'}`}>
              {text.length} / {resolvedMax}
            </p>
          )}
          <FieldError error={error} id={ids.error} />
        </div>
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
      </div>
    );
  }
}
