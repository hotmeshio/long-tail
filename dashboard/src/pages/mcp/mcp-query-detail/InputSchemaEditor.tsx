import { useState } from 'react';
import type { InputFieldMeta } from '../../../api/types';

interface InputSchemaEditorProps {
  fields: InputFieldMeta[];
  onChange: (fields: InputFieldMeta[]) => void;
  editing: boolean;
}

const CLASSIFICATION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  dynamic: { bg: 'bg-status-success/10', text: 'text-status-success', label: 'Dynamic' },
  fixed: { bg: 'bg-surface-sunken', text: 'text-text-tertiary', label: 'Fixed' },
  wired: { bg: 'bg-blue-500/10', text: 'text-blue-500', label: 'Wired' },
};

function ClassificationBadge({ classification }: { classification: string }) {
  const style = CLASSIFICATION_STYLES[classification] || CLASSIFICATION_STYLES.fixed;
  return (
    <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

export function InputSchemaEditor({ fields, onChange, editing }: InputSchemaEditorProps) {
  const [expandedField, setExpandedField] = useState<string | null>(null);

  const updateField = (index: number, updates: Partial<InputFieldMeta>) => {
    const next = fields.map((f, i) => i === index ? { ...f, ...updates } : f);
    onChange(next);
  };

  const toggleClassification = (index: number) => {
    const field = fields[index];
    const nextClass = field.classification === 'dynamic' ? 'fixed' : 'dynamic';
    const updates: Partial<InputFieldMeta> = { classification: nextClass };
    if (nextClass === 'fixed' && field.default === undefined) {
      // Set a sensible default when switching to fixed
      updates.default = field.type === 'string' ? '' : field.type === 'number' ? 0 : field.type === 'boolean' ? false : null;
    }
    updateField(index, updates);
  };

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  if (fields.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-xs text-text-tertiary">No input fields detected from the execution.</p>
      </div>
    );
  }

  const dynamicFields = fields.filter(f => f.classification === 'dynamic');
  const fixedFields = fields.filter(f => f.classification === 'fixed');

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-3 text-[10px] text-text-tertiary">
        <span>{dynamicFields.length} dynamic (user provides)</span>
        <span>{fixedFields.length} fixed (defaults from execution)</span>
      </div>

      {/* Dynamic fields */}
      {dynamicFields.length > 0 && (
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-status-success/70 mb-2">
            Dynamic Inputs (required at invocation)
          </p>
          <div className="space-y-1">
            {dynamicFields.map((field) => {
              const index = fields.indexOf(field);
              const isExpanded = expandedField === field.key;
              return (
                <FieldRow
                  key={field.key}
                  field={field}
                  editing={editing}
                  expanded={isExpanded}
                  onToggleExpand={() => setExpandedField(isExpanded ? null : field.key)}
                  onToggleClassification={() => toggleClassification(index)}
                  onUpdate={(updates) => updateField(index, updates)}
                  onRemove={() => removeField(index)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Fixed fields */}
      {fixedFields.length > 0 && (
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary mb-2">
            Fixed Defaults (from execution)
          </p>
          <div className="space-y-1">
            {fixedFields.map((field) => {
              const index = fields.indexOf(field);
              const isExpanded = expandedField === field.key;
              return (
                <FieldRow
                  key={field.key}
                  field={field}
                  editing={editing}
                  expanded={isExpanded}
                  onToggleExpand={() => setExpandedField(isExpanded ? null : field.key)}
                  onToggleClassification={() => toggleClassification(index)}
                  onUpdate={(updates) => updateField(index, updates)}
                  onRemove={() => removeField(index)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field Row ────────────────────────────────────────────────────────────────

function FieldRow({
  field,
  editing,
  expanded,
  onToggleExpand,
  onToggleClassification,
  onUpdate,
  onRemove,
}: {
  field: InputFieldMeta;
  editing: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleClassification: () => void;
  onUpdate: (updates: Partial<InputFieldMeta>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-surface-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover/50 transition-colors"
      >
        <span className="font-mono text-xs text-text-primary">{field.key}</span>
        <span className="text-[9px] text-text-tertiary">{field.type}</span>
        <ClassificationBadge classification={field.classification} />
        {field.default !== undefined && (
          <span className="text-[9px] font-mono text-text-tertiary truncate max-w-[120px]">
            = {JSON.stringify(field.default)}
          </span>
        )}
        <span className="text-[9px] text-text-tertiary ml-auto truncate max-w-[150px]">
          {field.source_tool}
        </span>
        <svg
          className={`w-3 h-3 text-text-tertiary shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-surface-border/50 space-y-2">
          <p className="text-[10px] text-text-tertiary">{field.description}</p>

          {editing && (
            <div className="space-y-2">
              {/* Description */}
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary">Description</label>
                <input
                  type="text"
                  value={field.description}
                  onChange={(e) => onUpdate({ description: e.target.value })}
                  className="input text-[11px] w-full mt-0.5"
                />
              </div>

              {/* Default value (for fixed fields) */}
              {field.classification === 'fixed' && (
                <div>
                  <label className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary">Default Value</label>
                  <input
                    type="text"
                    value={field.default !== undefined ? (typeof field.default === 'string' ? field.default : JSON.stringify(field.default)) : ''}
                    onChange={(e) => {
                      let val: unknown = e.target.value;
                      if (field.type === 'number') val = Number(val) || 0;
                      else if (field.type === 'boolean') val = val === 'true';
                      else { try { val = JSON.parse(val as string); } catch { /* keep as string */ } }
                      onUpdate({ default: val });
                    }}
                    className="input text-[11px] font-mono w-full mt-0.5"
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={onToggleClassification}
                  className="text-[10px] text-accent hover:underline"
                >
                  {field.classification === 'dynamic' ? 'Make fixed (add default)' : 'Make dynamic (require input)'}
                </button>
                <button
                  type="button"
                  onClick={onRemove}
                  className="text-[10px] text-status-error hover:underline ml-auto"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
