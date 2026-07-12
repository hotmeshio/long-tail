import { useState, useEffect, useCallback } from 'react';
import { WIDGET_MAP } from './widgets';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Renders a JSON object as an editable form with typed inputs.
 *
 * - Strings → text input (textarea if > 80 chars)
 * - Booleans → toggle switch
 * - Numbers → number input
 * - Null → disabled placeholder
 * - Objects → nested section
 * - Arrays of strings → tag display
 * - Keys starting with `_` → hidden (preserved in output)
 *
 * Calls `onChange` with the full JSON string on every edit.
 */
export function ResolverForm({ value, onChange, disabled, submitAttempted }: {
  value: string;
  onChange: (json: string) => void;
  disabled?: boolean;
  submitAttempted?: boolean;
}) {
  const [data, setData] = useState<Record<string, JsonValue>>({});
  const [hidden, setHidden] = useState<Record<string, JsonValue>>({});
  const [formSchema, setFormSchema] = useState<Record<string, any> | null>(null);
  const [parseError, setParseError] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  // Parse incoming JSON
  useEffect(() => {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const visible: Record<string, JsonValue> = {};
        const internal: Record<string, JsonValue> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (k.startsWith('_')) {
            internal[k] = v as JsonValue;
          } else {
            visible[k] = v as JsonValue;
          }
        }
        setData(visible);
        setHidden(internal);
        setFormSchema(
          internal._form_schema && typeof internal._form_schema === 'object'
            ? internal._form_schema as Record<string, any>
            : null,
        );
        setParseError(false);
      }
    } catch {
      setParseError(true);
    }
  }, [value]);

  const emitChange = useCallback((updated: Record<string, JsonValue>) => {
    setData(updated);
    onChange(JSON.stringify({ ...updated, ...hidden }, null, 2));
  }, [hidden, onChange]);

  const updateField = useCallback((key: string, val: JsonValue) => {
    emitChange({ ...data, [key]: val });
  }, [data, emitChange]);

  const markTouched = useCallback((key: string) => {
    setTouched((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  if (parseError) {
    return (
      <p className="text-xs text-status-error">
        Unable to parse resolver data as form. Use the JSON editor below.
      </p>
    );
  }

  const allEntries = Object.entries(data);
  if (allEntries.length === 0) {
    return (
      <p className="text-xs text-text-tertiary italic">
        No resolver fields defined.
      </p>
    );
  }

  // Field ordering via x-lt-order
  const fieldOrder = formSchema?.['x-lt-order'] as string[] | undefined;
  const entries = fieldOrder
    ? [...allEntries].sort((a, b) => {
        const ai = fieldOrder.indexOf(a[0]);
        const bi = fieldOrder.indexOf(b[0]);
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      })
    : allEntries;

  const requiredFields = new Set(formSchema?.required as string[] ?? []);
  const layout = formSchema?.['x-lt-layout'] as string | undefined;
  const schemaTitle = formSchema?.title as string | undefined;
  const schemaDescription = formSchema?.description as string | undefined;

  const fieldRows = entries.map(([key, val]) => {
    const fieldSchema = formSchema?.properties?.[key] as Record<string, unknown> | undefined;
    const isReadOnly = fieldSchema?.readOnly === true;
    const span = (fieldSchema?.['x-lt-span'] as number) ?? 1;
    const isReq = requiredFields.has(key);
    const isTouched = touched.has(key) || !!submitAttempted;

    // Derive inline error for touched required fields
    let error: string | undefined;
    if (isReq && isTouched) {
      if (val === undefined || val === null) {
        error = 'Required';
      } else if (typeof val === 'string' && val.trim() === '') {
        error = 'Required';
      }
    }
    // Format-specific validation for touched fields
    if (isTouched && typeof val === 'string' && val.trim() !== '' && fieldSchema) {
      const fmt = fieldSchema.format as string | undefined;
      if (fmt === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        error = 'Enter a valid email address';
      }
      if (fmt === 'uri' && !/^https?:\/\/.+/.test(val)) {
        error = 'Enter a valid URL';
      }
    }

    return (
      <div
        key={key}
        className={layout === 'two-column' && span >= 2 ? 'col-span-2' : ''}
      >
        <FieldRow
          fieldKey={key}
          value={val}
          onChange={(v) => updateField(key, v)}
          onBlur={() => markTouched(key)}
          schema={formSchema}
          isRequired={isReq}
          isReadOnly={isReadOnly}
          error={error}
        />
      </div>
    );
  });

  return (
    <div className={`pb-8 ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Schema title and description */}
      {schemaTitle && (
        <h3 className="text-lg font-light text-text-primary mb-1">{schemaTitle}</h3>
      )}
      {schemaDescription && (
        <p className="text-sm text-text-secondary leading-relaxed mb-6">{schemaDescription}</p>
      )}

      {/* Layout modes */}
      {layout === 'two-column' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-14 gap-y-6">{fieldRows}</div>
      ) : (
        <div className="space-y-6">{fieldRows}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field row — renders appropriate input per type
// ---------------------------------------------------------------------------

function FieldRow({ fieldKey, value, onChange, onBlur, schema, isRequired, isReadOnly, error }: {
  fieldKey: string;
  value: JsonValue;
  onChange: (v: JsonValue) => void;
  onBlur?: () => void;
  schema?: Record<string, any> | null;
  isRequired?: boolean;
  isReadOnly?: boolean;
  error?: string;
}) {
  const label = fieldKey.replace(/[_-]/g, ' ');
  const fieldSchema = schema?.properties?.[fieldKey] as Record<string, any> | undefined;
  const widgetName = fieldSchema?.['x-lt-widget'] as string | undefined;

  // Markdown dispatches ahead of the read-only branch: a readOnly markdown
  // field is a CONTENT BLOCK — the widget renders its source as HTML (the
  // versioned schema carries the page source), not as static text.
  const isMarkdown = widgetName === 'markdown' && typeof value === 'string';

  // Read-only fields display as static text
  if (isReadOnly && !isMarkdown) {
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

  // Custom widget via x-lt-widget (string fields only)
  if (widgetName && widgetName in WIDGET_MAP && typeof value === 'string') {
    const Widget = WIDGET_MAP[widgetName];
    return <Widget fieldKey={fieldKey} value={value} onChange={(v) => onChange(v)} schema={fieldSchema} />;
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
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            {label}
            {isRequired && <span className="text-status-error ml-0.5">*</span>}
          </span>
        </label>
        <FieldError error={error} />
      </div>
    );
  }

  // Number
  if (typeof value === 'number') {
    return (
      <div>
        <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          onBlur={onBlur}
          step="any"
          className={inputClass(!!error)}
        />
        <FieldError error={error} />
      </div>
    );
  }

  // String
  if (typeof value === 'string') {
    const isPassword = fieldSchema?.format === 'password';
    const enumValues = fieldSchema?.enum as string[] | undefined;
    const helperText = fieldSchema?.description as string | undefined;

    if (enumValues?.length) {
      return (
        <div>
          <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
          {helperText && <p className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={inputClass(!!error)}
          >
            {enumValues.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <FieldError error={error} />
        </div>
      );
    }

    if (isPassword) {
      return (
        <div>
          <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
          {helperText && <p className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
          <input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={inputClass(!!error)}
            autoComplete="off"
          />
          <FieldError error={error} />
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
          <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
          {helperText && <p className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
          <input
            type={FORMAT_INPUT_TYPES[format]}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={inputClass(!!error)}
          />
          <FieldError error={error} />
        </div>
      );
    }

    // Explicit textarea format or long content
    if (format === 'textarea' || value.length > 80) {
      return (
        <div>
          <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
          {helperText && <p className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className={`${inputClass(!!error)} leading-relaxed`}
            rows={Math.min(6, Math.max(3, Math.ceil(value.length / 60)))}
          />
          <FieldError error={error} />
        </div>
      );
    }

    return (
      <div>
        <FieldLabel isRequired={isRequired}>{label}</FieldLabel>
        {helperText && <p className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={inputClass(!!error)}
        />
        <FieldError error={error} />
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
              className="px-2 py-0.5 text-[11px] font-mono bg-surface-sunken rounded text-text-secondary"
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

function FieldLabel({ children, isRequired }: { children: React.ReactNode; isRequired?: boolean }) {
  return (
    <label className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
      {children}
      {isRequired && <span className="text-status-error ml-0.5">*</span>}
    </label>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="text-[10px] text-status-error mt-1 animate-[field-error-in_0.3s_ease-out]">
      {error}
    </p>
  );
}

function inputClass(hasError?: boolean): string {
  return hasError
    ? 'input text-sm w-full mt-1 border-status-error/50 focus:border-status-error animate-[field-shake_0.4s_ease-in-out]'
    : 'input text-sm w-full mt-1';
}
