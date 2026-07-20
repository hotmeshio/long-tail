import { useState, useEffect, useCallback } from 'react';
import { Layers } from 'lucide-react';
import { WIDGET_MAP } from './widgets';
import { evaluateShowIf, type ShowIfContext } from '../../lib/x-lt-show-if';
import { validateField } from '../../lib/field-validator';

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
export function ResolverForm({ value, onChange, disabled, submitAttempted, escalationContext }: {
  value: string;
  onChange: (json: string) => void;
  disabled?: boolean;
  submitAttempted?: boolean;
  escalationContext?: ShowIfContext;
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
  const ordered = fieldOrder
    ? [...allEntries].sort((a, b) => {
        const ai = fieldOrder.indexOf(a[0]);
        const bi = fieldOrder.indexOf(b[0]);
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      })
    : allEntries;

  // Merge current form data into the resolver domain so x-lt-showIf: 'resolver.field'
  // reacts to live edits — the parent context only carries the saved row state.
  const liveCtx: ShowIfContext = { ...(escalationContext ?? {}), resolver: data as Record<string, unknown> };

  // Conditional visibility via x-lt-showIf and x-lt-hide-if-empty
  const entries = ordered.filter(([key, val]) => {
    const fieldSchema = formSchema?.properties?.[key] as Record<string, unknown> | undefined;
    if (!evaluateShowIf(fieldSchema?.['x-lt-showIf'], liveCtx)) return false;
    if (fieldSchema?.['x-lt-hide-if-empty'] === true) {
      const isEmpty = val === null || val === undefined || val === '' || val === false || val === 0;
      if (isEmpty) return false;
    }
    return true;
  });

  const requiredFields = new Set(formSchema?.required as string[] ?? []);
  const layout = formSchema?.['x-lt-layout'] as string | undefined;
  const schemaTitle = formSchema?.title as string | undefined;
  const schemaDescription = formSchema?.description as string | undefined;

  // Group entries by x-lt-section for labeled visual grouping.
  // Fields without x-lt-section or with an empty value form an unnamed group.
  type SectionGroup = { name: string | null; entries: [string, JsonValue][] };
  const sectionGroups: SectionGroup[] = [];
  for (const entry of entries) {
    const [key] = entry;
    const fieldSchema = formSchema?.properties?.[key] as Record<string, unknown> | undefined;
    const sectionName = (fieldSchema?.['x-lt-section'] as string | undefined)?.trim() || null;
    const last = sectionGroups[sectionGroups.length - 1];
    if (!last || last.name !== sectionName) {
      sectionGroups.push({ name: sectionName, entries: [entry] });
    } else {
      last.entries.push(entry);
    }
  }

  const renderGroupFields = (groupEntries: [string, JsonValue][]) =>
    groupEntries.map(([key, val]) => {
      const fieldSchema = formSchema?.properties?.[key] as Record<string, unknown> | undefined;
      const isReadOnly = fieldSchema?.readOnly === true;
      const span = (fieldSchema?.['x-lt-span'] as number) ?? 1;
      const isReq = requiredFields.has(key);
      const isTouched = touched.has(key) || !!submitAttempted;

      const error = validateField(val, fieldSchema, isReq, isTouched, liveCtx as Record<string, unknown>);

      return (
        <div
          key={key}
          className={`animate-[field-enter_0.2s_ease-out] ${layout === 'two-column' && span >= 2 ? 'col-span-2' : ''}`}
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
            escalationContext={liveCtx}
            submitAttempted={!!submitAttempted}
          />
        </div>
      );
    });

  return (
    // `inert` (not just pointer-events) locks a disabled form for keyboard and
    // assistive-tech users too — fields leave the tab order entirely.
    <div
      className={`pb-8 ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
      inert={disabled || undefined}
      aria-disabled={disabled || undefined}
    >
      {schemaTitle && (
        <h3 className="text-lg font-light text-text-primary mb-1">{schemaTitle}</h3>
      )}
      {schemaDescription && (
        <p className="text-sm text-text-secondary leading-relaxed mb-6">{schemaDescription}</p>
      )}

      <div className="space-y-10">
        {sectionGroups.map((group, i) => (
          <div
            key={group.name ?? `__s${i}`}
            className={group.name
              // Sections sit on the sunken band — a shade DARKER than the
              // lightest field fill, so embedded inputs pop against the group
              // the same way they pop against the filter bars. Theme-driven,
              // never a hardcoded hex.
              ? 'border-l-2 border-accent/30 bg-surface-sunken/80 rounded-[0.125em] p-4 animate-[section-enter_0.25s_ease-out]'
              : ''}
          >
            {group.name && (
              <div className="mb-5 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-accent/50 shrink-0" strokeWidth={1.5} />
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                  {group.name}
                </p>
              </div>
            )}
            {layout === 'two-column' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-14 gap-y-6">
                {renderGroupFields(group.entries)}
              </div>
            ) : (
              <div className="space-y-6">
                {renderGroupFields(group.entries)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field row — renders appropriate input per type
// ---------------------------------------------------------------------------

function FieldRow({ fieldKey, value, onChange, onBlur, schema, isRequired, isReadOnly, error, escalationContext, submitAttempted }: {
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
  const label = fieldKey.replace(/[_-]/g, ' ');
  const fieldSchema = schema?.properties?.[fieldKey] as Record<string, any> | undefined;
  const widgetName = fieldSchema?.['x-lt-widget'] as string | undefined;

  // Accessible wiring shared by every input branch: explicit label-for-input
  // association, and error/helper text linked via aria-describedby.
  const fieldId = `lt-field-${fieldKey}`;
  const errorId = `${fieldId}-error`;
  const helpId = `${fieldId}-help`;
  const hasHelper = typeof fieldSchema?.description === 'string' && fieldSchema.description.length > 0;
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
  // String fields pass the value directly. Object fields (e.g. checklist) are
  // JSON-serialized into the widget and parsed back on change — the widget
  // interface always deals in strings; FieldRow owns the object ↔ string boundary.
  if (widgetName && widgetName in WIDGET_MAP) {
    const Widget = WIDGET_MAP[widgetName];
    const widgetProps = { fieldKey, schema: fieldSchema, escalationContext, isRequired, submitAttempted, error };
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
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            {label}
            {isRequired && <span className="text-status-error ml-0.5">*</span>}
          </span>
        </label>
        <FieldError error={error} id={errorId} />
      </div>
    );
  }

  // Number
  if (typeof value === 'number') {
    return (
      <div>
        <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          onBlur={onBlur}
          step="any"
          data-field-key={fieldKey}
          className={inputClass(!!error)}
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
    const helperText = fieldSchema?.description as string | undefined;

    if (enumValues?.length) {
      return (
        <div>
          <FieldLabel isRequired={isRequired} htmlFor={fieldId}>{label}</FieldLabel>
          {helperText && <p id={helpId} className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            data-field-key={fieldKey}
            className={selectClass(!!error)}
            {...ariaProps}
          >
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
          {helperText && <p id={helpId} className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
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
          {helperText && <p id={helpId} className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
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
          {helperText && <p id={helpId} className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
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
            <p className={`text-[10px] mt-0.5 text-right tabular-nums ${isOverMax ? 'text-status-error font-medium' : 'text-text-quaternary'}`}>
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
        {helperText && <p id={helpId} className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
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

function FieldLabel({ children, isRequired, htmlFor }: { children: React.ReactNode; isRequired?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
      {children}
      {isRequired && <span className="text-status-error ml-0.5">*</span>}
    </label>
  );
}

function FieldError({ error, id }: { error?: string; id?: string }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="text-[10px] text-status-error mt-1 animate-[field-error-in_0.3s_ease-out]">
      {error}
    </p>
  );
}

function inputClass(hasError?: boolean): string {
  return hasError
    ? 'input text-sm w-full mt-1 border-status-error/50 focus:border-status-error animate-[field-shake_0.4s_ease-in-out]'
    : 'input text-sm w-full mt-1';
}

// Select shares the field recipe but adds the unified chevron (via .select), so
// generated dropdowns match every other select in the product.
function selectClass(hasError?: boolean): string {
  return hasError
    ? 'select text-sm w-full mt-1 border-status-error/50 focus:border-status-error animate-[field-shake_0.4s_ease-in-out]'
    : 'select text-sm w-full mt-1';
}
