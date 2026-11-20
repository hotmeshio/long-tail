import { memo } from 'react';
import { WIDGET_MAP } from '../widgets';
import { JSON_WIDGET } from '../widgets/field-widgets';
import { type ShowIfContext } from '../../../lib/x-lt-show-if';
import { resolveFieldOptions } from '../../../lib/x-lt-options';
import { deriveFieldLabel } from '../../../lib/derive-field-label';
import { FieldLabel } from './FieldChrome';
import { declaredKind, type JsonValue } from './form-cells';
import type { FieldControlProps } from './field-control-props';
import { SelectField } from './SelectField';
import { ListRow } from './list/ListRow';
import { ListDisplay } from './list/ListDisplay';
import { JsonField } from './JsonField';
import { ListField } from './ListField';
import { readScanSink } from '../../../lib/x-lt-scan';
import { listControlOf } from '../../../lib/x-lt-list';
import { useFieldNotice } from './field-notice';
import { ScalarControl, type ScalarKind } from './ScalarControl';
import { sameFieldRow } from './field-row-equality';

/**
 * Field row: the control follows the field's declared `type` and its tokens;
 * the stored value only fills it. The `data-field-key` attribute and
 * `lt-field-*` ids are load-bearing: the errors panel scroll-and-focus and
 * the test suite target them.
 */
function FieldRowImpl({ fieldKey, value, onChange, onBlur, schema, fieldSchema: fieldSchemaProp, isRequired, isReadOnly, locked, error, escalationContext, submitAttempted }: {
  fieldKey: string;
  value: JsonValue;
  onChange: (v: JsonValue) => void;
  onBlur?: () => void;
  schema?: Record<string, any> | null;
  /** The field's own schema, for a control that sits outside the form's properties (a table cell). */
  fieldSchema?: Record<string, any>;
  isRequired?: boolean;
  isReadOnly?: boolean;
  /** The form is shown but not editable: list controls hide their add and remove controls. */
  locked?: boolean;
  error?: string;
  escalationContext?: ShowIfContext;
  submitAttempted?: boolean;
}) {
  const fieldSchema = fieldSchemaProp ?? (schema?.properties?.[fieldKey] as Record<string, any> | undefined);
  const notice = useFieldNotice(fieldKey);
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

  const listValue = kind === 'array' && (Array.isArray(value) || value === null);
  if ((isReadOnly || (locked && widgetName !== JSON_WIDGET && listControlOf(fieldSchema) !== null)) && listValue && !hasRegisteredWidget) {
    return (
      <ListDisplay
        fieldKey={fieldKey}
        label={label}
        value={value}
        fieldSchema={fieldSchema}
        context={escalationContext as Record<string, unknown> | undefined}
        helperText={helperText}
        isRequired={isRequired}
        ids={ids}
      />
    );
  }

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

  if (widgetName === JSON_WIDGET && (kind === 'array' || kind === 'object')) {
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
    const listControl = listControlOf(fieldSchema, options?.length);
    if (listControl && listControl !== 'json' && (Array.isArray(value) || value === null)) {
      return (
        <ListRow
          control={listControl}
          options={options}
          value={value}
          fieldSchema={fieldSchema}
          context={escalationContext as Record<string, unknown> | undefined}
          locked={locked}
          props={control}
        />
      );
    }
  } else if (options !== undefined && kind !== 'object') {
    return <SelectField {...control} value={value} options={options} nullable={fieldSchema?.['x-lt-nullable'] === true} />;
  }

  const scalar = (as: ScalarKind, v: JsonValue) => (
    <ScalarControl kind={as} value={v} fieldSchema={fieldSchema} context={escalationContext as Record<string, unknown> | undefined} notice={notice} control={control} />
  );
  const text = (v: JsonValue) => scalar('string', v === null || v === undefined ? '' : String(v));

  switch (kind) {
    case 'boolean':
    case 'number':
    case 'integer':
    case 'string':
      return scalar(kind, value);

    case 'array':
      // Without an option list or the json widget a list displays; a scan list is a checklist.
      if (!Array.isArray(value) && !(value == null && readScanSink(fieldSchema))) return text(value);
      return (
        <ListField
          fieldKey={fieldKey}
          label={label}
          values={Array.isArray(value) ? value : []}
          fieldSchema={fieldSchema}
          helperText={helperText}
          isRequired={isRequired}
          error={error}
          ids={ids}
          notice={notice}
          context={escalationContext as Record<string, unknown> | undefined}
          onChange={onChange}
        />
      );

    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return text(value);
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
}

export const FieldRow = memo(FieldRowImpl, sameFieldRow);
