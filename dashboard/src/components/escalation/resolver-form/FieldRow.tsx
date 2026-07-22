import { WIDGET_MAP } from '../widgets';
import { type ShowIfContext } from '../../../lib/x-lt-show-if';
import { deriveFieldLabel } from '../../../lib/derive-field-label';
import { FieldLabel, FieldHelper, FieldError, inputClass, selectClass } from './FieldChrome';
import { type JsonValue } from './form-cells';

/**
 * Field row — renders the appropriate input per JSON type and schema hints.
 * The `data-field-key` attribute and `lt-field-*` ids are load-bearing: the
 * errors panel scroll-and-focus and the test suite target them.
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

  // Accessible wiring shared by every input branch: explicit label-for-input
  // association, and error/helper text linked via aria-describedby.
  const fieldId = `lt-field-${fieldKey}`;
  const errorId = `${fieldId}-error`;
  const helpId = `${fieldId}-help`;
  // The instruction line renders on EVERY editable input, in one fixed
  // anatomy: label, instruction, control. No input goes without.
  const helperText = typeof fieldSchema?.description === 'string' && fieldSchema.description.length > 0
    ? fieldSchema.description
    : undefined;
  const hasHelper = helperText !== undefined;
  const describedBy = error ? errorId : hasHelper ? helpId : undefined;
  const ariaProps = {
    id: fieldId,
    'aria-required': isRequired || undefined,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  } as const;

  // Some widgets dispatch ahead of the read-only branch: a readOnly markdown
  // field is a CONTENT BLOCK (renders its source as HTML), and a readOnly
  // attachment/image renders the captured binary — never static text.
  const isMarkdown = widgetName === 'markdown' && typeof value === 'string';
  const isAttachment = (widgetName === 'attachment' || widgetName === 'image') && typeof value === 'string';

  // Read-only fields display as static text
  if (isReadOnly && !isMarkdown && !isAttachment) {
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

  // Custom widget via x-lt-widget.
  // The widget interface always deals in strings; FieldRow owns the
  // object ↔ string boundary, decided by the DECLARED type — never the
  // runtime value. An object-typed field (checklist) stores an object in
  // the form data on every change, so a stray string value (an old draft,
  // an empty init) heals on the next interaction instead of sticking.
  if (widgetName && widgetName in WIDGET_MAP) {
    const Widget = WIDGET_MAP[widgetName];
    // A require-all checklist is required by definition — its label carries
    // the asterisk like any other required input.
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

  // Boolean → checkbox
  if (typeof value === 'boolean') {
    return (
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value}
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
        {helperText && <FieldHelper id={helpId}>{helperText}</FieldHelper>}
        <FieldError error={error} id={errorId} />
      </div>
    );
  }

  // Number — numbers are short; the input holds a hand-sized width instead
  // of stretching to the measure.
  if (typeof value === 'number') {
    return (
      <div>
        <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
        {helperText && <FieldHelper id={helpId}>{helperText}</FieldHelper>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          onBlur={onBlur}
          step="any"
          data-field-key={fieldKey}
          className={`${inputClass(!!error)} max-w-48`}
          {...ariaProps}
        />
        <FieldError error={error} id={errorId} />
      </div>
    );
  }

  // String
  if (typeof value === 'string') {
    const isPassword = fieldSchema?.format === 'password';
    const enumValues = fieldSchema?.enum as string[] | undefined;

    if (enumValues?.length) {
      // An empty value on an enum whose options don't include '' renders an
      // explicit "Choose…" placeholder: the decision is the user's, never an
      // implicit first option. Once chosen there is no way back to unchosen.
      const needsPlaceholder = value === '' && !enumValues.includes('');
      return (
        <div>
          <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
          {helperText && <FieldHelper id={helpId}>{helperText}</FieldHelper>}
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            data-field-key={fieldKey}
            className={selectClass(!!error)}
            {...ariaProps}
          >
            {needsPlaceholder && <option value="" disabled>Choose…</option>}
            {enumValues.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <FieldError error={error} id={errorId} />
        </div>
      );
    }

    if (isPassword) {
      return (
        <div>
          <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
          {helperText && <FieldHelper id={helpId}>{helperText}</FieldHelper>}
          <input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            data-field-key={fieldKey}
            className={inputClass(!!error)}
            autoComplete="off"
            {...ariaProps}
          />
          <FieldError error={error} id={errorId} />
        </div>
      );
    }

    // Format-based input types
    const format = fieldSchema?.format as string | undefined;
    const FORMAT_INPUT_TYPES: Record<string, string> = {
      date: 'date',
      'date-time': 'datetime-local',
      email: 'email',
      uri: 'url',
    };
    if (format && format in FORMAT_INPUT_TYPES) {
      return (
        <div>
          <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
          {helperText && <FieldHelper id={helpId}>{helperText}</FieldHelper>}
          <input
            type={FORMAT_INPUT_TYPES[format]}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            data-field-key={fieldKey}
            className={inputClass(!!error)}
            {...ariaProps}
          />
          <FieldError error={error} id={errorId} />
        </div>
      );
    }

    // Explicit textarea format or long content
    if (format === 'textarea' || value.length > 80) {
      // Resolve effective maxLength for live counter — static schema wins, then dynamic path
      const staticMax = fieldSchema?.maxLength as number | undefined;
      const dynamicMaxPath = fieldSchema?.['x-lt-max-length'] as string | undefined;
      let resolvedMax: number | undefined = staticMax;
      if (resolvedMax === undefined && dynamicMaxPath && escalationContext) {
        const dot = dynamicMaxPath.indexOf('.');
        if (dot !== -1) {
          const domain = dynamicMaxPath.slice(0, dot);
          const path = dynamicMaxPath.slice(dot + 1);
          const domainObj = (escalationContext as Record<string, unknown>)[domain];
          if (domainObj && typeof domainObj === 'object') {
            let cur: unknown = domainObj;
            for (const p of path.split('.')) {
              cur = (cur as Record<string, unknown>)[p];
              if (cur === undefined) break;
            }
            if (typeof cur === 'number') resolvedMax = cur;
            else if (typeof cur === 'string') { const n = Number(cur); if (!Number.isNaN(n)) resolvedMax = n; }
          }
        }
      }
      const isOverMax = resolvedMax !== undefined && value.length > resolvedMax;

      return (
        <div>
          <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
          {helperText && <FieldHelper id={helpId}>{helperText}</FieldHelper>}
          <textarea
            value={value}
            onChange={(e) => { onChange(e.target.value); onBlur?.(); }}
            onBlur={onBlur}
            data-field-key={fieldKey}
            className={`${inputClass(!!error)} leading-relaxed`}
            rows={Math.min(6, Math.max(3, Math.ceil(value.length / 60)))}
            {...ariaProps}
          />
          {resolvedMax !== undefined && (
            <p className={`text-2xs mt-0.5 text-right tabular-nums ${isOverMax ? 'text-status-error font-medium' : 'text-text-quaternary'}`}>
              {value.length} / {resolvedMax}
            </p>
          )}
          <FieldError error={error} id={errorId} />
        </div>
      );
    }

    return (
      <div>
        <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
        {helperText && <FieldHelper id={helpId}>{helperText}</FieldHelper>}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          data-field-key={fieldKey}
          className={inputClass(!!error)}
          {...ariaProps}
        />
        <FieldError error={error} id={errorId} />
      </div>
    );
  }

  // Null
  if (value === null) {
    return (
      <div>
        <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
        <p className="text-xs text-text-tertiary italic mt-1">null</p>
      </div>
    );
  }

  // Array of primitives
  if (Array.isArray(value)) {
    return (
      <div>
        <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {value.map((item, i) => (
            <span
              key={i}
              className="px-2 py-0.5 text-2xs font-mono bg-surface-sunken rounded text-text-secondary"
            >
              {String(item)}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Nested object → recursive
  if (typeof value === 'object') {
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

  return null;
}
