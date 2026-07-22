import { useState, useEffect, useCallback } from 'react';
import { HelpCircle } from 'lucide-react';
import { evaluateShowIf, type ShowIfContext } from '../../../lib/x-lt-show-if';
import { validateField } from '../../../lib/field-validator';
import { FieldRow } from './FieldRow';
import { SectionGroup } from './SectionGroup';
import { type FormEntry, type JsonValue } from './form-cells';

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
export function ResolverForm({ value, onChange, disabled, submitAttempted, escalationContext, onOpenHelp }: {
  value: string;
  onChange: (json: string) => void;
  disabled?: boolean;
  submitAttempted?: boolean;
  escalationContext?: ShowIfContext;
  /** Opens the Instructions panel view; renders a help icon when the schema carries authored help. */
  onOpenHelp?: () => void;
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
  const hasAuthoredHelp =
    typeof formSchema?.['x-lt-help'] === 'string' || typeof formSchema?.['x-lt-context'] === 'string';

  // Group entries by x-lt-section for labeled visual grouping.
  // Fields without x-lt-section or with an empty value form an unnamed group.
  type Section = { name: string | null; entries: FormEntry[] };
  const sectionGroups: Section[] = [];
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

  const renderField = ([key, val]: FormEntry) => {
    const fieldSchema = formSchema?.properties?.[key] as Record<string, unknown> | undefined;
    const isReadOnly = fieldSchema?.readOnly === true;
    const span = (fieldSchema?.['x-lt-span'] as number) ?? 1;
    const isReq = requiredFields.has(key);
    const isTouched = touched.has(key) || !!submitAttempted;

    const error = validateField(val, fieldSchema, isReq, isTouched, liveCtx as Record<string, unknown>);

    return (
      <div
        key={key}
        className={`animate-[field-enter_0.2s_ease-out] ${layout === 'two-column' && span >= 2 ? 'col-span-full' : ''}`}
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
  };

  return (
    // `inert` (not just pointer-events) locks a disabled form for keyboard and
    // assistive-tech users too — fields leave the tab order entirely.
    // max-w-form: the form holds a readable measure on any monitor.
    <div
      className={`pb-8 max-w-form ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
      inert={disabled || undefined}
      aria-disabled={disabled || undefined}
    >
      {schemaTitle && (
        <div className="mb-1 flex items-center gap-1.5">
          <h3 className="heading-3">{schemaTitle}</h3>
          {hasAuthoredHelp && onOpenHelp && (
            <button
              type="button"
              onClick={onOpenHelp}
              title="Open instructions"
              aria-label="Open instructions"
              className="p-1 rounded-md text-text-tertiary hover:text-accent hover:bg-surface-hover transition-colors"
            >
              <HelpCircle className="w-4 h-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      )}
      {schemaDescription && (
        <p className="text-sm text-text-secondary leading-relaxed mb-6">{schemaDescription}</p>
      )}

      <div className="space-y-8">
        {sectionGroups.map((group, i) => (
          <SectionGroup
            key={group.name ?? `__s${i}`}
            name={group.name}
            entries={group.entries}
            formSchema={formSchema}
            layout={layout}
            renderField={renderField}
          />
        ))}
      </div>
    </div>
  );
}
