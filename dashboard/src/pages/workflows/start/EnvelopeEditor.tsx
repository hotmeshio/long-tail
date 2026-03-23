import type { LTWorkflowConfig } from '../../../api/types';

interface DataField {
  key: string;
  type: string;
  defaultValue: unknown;
}

export function EnvelopeEditor({
  selectedConfig,
  isJsonMode,
  hasFormView,
  jsonInput,
  formFields,
  dataFields,
  onJsonChange,
  onToggleMode,
  onUpdateFormField,
  onSetFormFields,
}: {
  selectedConfig: LTWorkflowConfig;
  isJsonMode: boolean;
  hasFormView: boolean;
  jsonInput: string;
  formFields: Record<string, unknown>;
  dataFields: DataField[];
  onJsonChange: (value: string) => void;
  onToggleMode: () => void;
  onUpdateFormField: (key: string, value: unknown, type: string) => void;
  onSetFormFields: (fields: Record<string, unknown>) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="block text-xs text-text-secondary">
          Envelope
        </label>
        <div className="flex items-center gap-3">
          {hasFormView && (
            <button
              type="button"
              onClick={onToggleMode}
              className="text-[10px] text-accent hover:underline"
            >
              {isJsonMode ? 'Form view' : 'JSON view'}
            </button>
          )}
          {selectedConfig.envelope_schema ? (
            <span className="text-[10px] text-accent">
              Pre-filled from workflow config
            </span>
          ) : (
            <span className="text-[10px] text-status-warning">
              No template
            </span>
          )}
        </div>
      </div>

      {!selectedConfig.envelope_schema && (
        <div className="bg-surface-sunken border border-surface-border rounded px-4 py-3 mb-3">
          <p className="text-xs text-text-secondary leading-relaxed">
            No envelope template is configured for this workflow.
            You can edit the JSON directly below, or configure a
            template via <span className="text-accent">Admin &rarr; Workflow Configs</span> for
            pre-filled fields and form-based input.
          </p>
        </div>
      )}

      {isJsonMode || !hasFormView ? (
        /* JSON view */
        <textarea
          value={jsonInput}
          onChange={(e) => onJsonChange(e.target.value)}
          className="input font-mono text-xs"
          rows={12}
          spellCheck={false}
        />
      ) : (
        /* Form view */
        <div className="space-y-3">
          {dataFields.map(({ key, type }) => {
            const value = formFields[key];
            const jsonValue =
              typeof value === 'string'
                ? value
                : JSON.stringify(
                    value ?? (type === 'array' ? [] : {}),
                    null,
                    2,
                  );
            const textareaRows = Math.min(
              20,
              Math.max(4, (jsonValue?.split?.('\n')?.length ?? 4)),
            );
            return (
              <div key={key}>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1">
                  {key}
                  <span className="ml-2 font-normal normal-case">
                    {type}
                  </span>
                </label>
                {type === 'boolean' ? (
                  <select
                    value={String(value ?? false)}
                    onChange={(e) =>
                      onUpdateFormField(key, e.target.value, type)
                    }
                    className="select text-xs w-full"
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : type === 'object' || type === 'array' ? (
                  <textarea
                    value={jsonValue}
                    onChange={(e) => {
                      try {
                        onUpdateFormField(
                          key,
                          JSON.parse(e.target.value),
                          type,
                        );
                      } catch {
                        // Keep raw text without syncing to JSON
                        onSetFormFields({
                          ...formFields,
                          [key]: e.target.value,
                        });
                      }
                    }}
                    className="input font-mono text-[11px] w-full leading-relaxed"
                    rows={textareaRows}
                    spellCheck={false}
                  />
                ) : (
                  <input
                    type={type === 'number' ? 'number' : 'text'}
                    value={String(value ?? '')}
                    onChange={(e) =>
                      onUpdateFormField(key, e.target.value, type)
                    }
                    className="input text-xs w-full"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-text-tertiary mt-1.5">
        The envelope wraps your workflow input. <code className="text-accent/80">data</code> holds workflow-specific fields; <code className="text-accent/80">metadata</code> is optional context.
      </p>
    </div>
  );
}
