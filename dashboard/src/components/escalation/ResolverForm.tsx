import { useState, useEffect, useCallback } from 'react';

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
export function ResolverForm({ value, onChange }: {
  value: string;
  onChange: (json: string) => void;
}) {
  const [data, setData] = useState<Record<string, JsonValue>>({});
  const [hidden, setHidden] = useState<Record<string, JsonValue>>({});
  const [formSchema, setFormSchema] = useState<Record<string, any> | null>(null);
  const [parseError, setParseError] = useState(false);

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

  if (parseError) {
    return (
      <p className="text-xs text-status-error">
        Unable to parse resolver data as form. Use the JSON editor below.
      </p>
    );
  }

  const entries = Object.entries(data);
  if (entries.length === 0) {
    return (
      <p className="text-xs text-text-tertiary italic">
        No resolver fields defined.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map(([key, val]) => (
        <FieldRow
          key={key}
          fieldKey={key}
          value={val}
          onChange={(v) => updateField(key, v)}
          schema={formSchema}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field row — renders appropriate input per type
// ---------------------------------------------------------------------------

function FieldRow({ fieldKey, value, onChange, schema }: {
  fieldKey: string;
  value: JsonValue;
  onChange: (v: JsonValue) => void;
  schema?: Record<string, any> | null;
}) {
  const label = fieldKey.replace(/[_-]/g, ' ');
  const fieldSchema = schema?.properties?.[fieldKey] as Record<string, any> | undefined;

  // Boolean → checkbox
  if (typeof value === 'boolean') {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="w-3.5 h-3.5 rounded accent-accent"
        />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          {label}
        </span>
      </label>
    );
  }

  // Number
  if (typeof value === 'number') {
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          step="any"
          className="input text-sm w-full mt-1"
        />
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
          <FieldLabel>{label}</FieldLabel>
          {helperText && <p className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input text-sm w-full mt-1"
          >
            {enumValues.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }

    if (isPassword) {
      return (
        <div>
          <FieldLabel>{label}</FieldLabel>
          {helperText && <p className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
          <input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input text-sm w-full mt-1"
            autoComplete="off"
          />
        </div>
      );
    }

    if (value.length > 80) {
      return (
        <div>
          <FieldLabel>{label}</FieldLabel>
          {helperText && <p className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input text-sm w-full mt-1 leading-relaxed"
            rows={Math.min(6, Math.ceil(value.length / 60))}
          />
        </div>
      );
    }
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        {helperText && <p className="text-[10px] text-text-tertiary mt-0.5">{helperText}</p>}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input text-sm w-full mt-1"
        />
      </div>
    );
  }

  // Null
  if (value === null) {
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <p className="text-xs text-text-tertiary italic mt-1">null</p>
      </div>
    );
  }

  // Array of primitives
  if (Array.isArray(value)) {
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
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
        <FieldLabel>{label}</FieldLabel>
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
      {children}
    </label>
  );
}
