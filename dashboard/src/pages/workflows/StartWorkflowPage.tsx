import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkflowConfigs, useInvokeWorkflow } from '../../api/workflows';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { SectionLabel } from '../../components/common/layout/SectionLabel';
import { Pill } from '../../components/common/display/Pill';
import type { LTWorkflowConfig } from '../../api/types';

const DEFAULT_ENVELOPE = '{\n  "data": {},\n  "metadata": {}\n}';

/** Infer a simple field type from a value. */
function inferTypeFromValue(value: unknown): string {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  return 'string';
}

/** Extract the data keys from an envelope_schema and their inferred types. */
function extractDataFields(
  schema: Record<string, unknown> | null,
): { key: string; type: string; defaultValue: unknown }[] {
  if (!schema) return [];
  const data = schema.data;
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data as Record<string, unknown>).map(([key, value]) => ({
    key,
    type: inferTypeFromValue(value),
    defaultValue: value,
  }));
}

/** Build form field values from data object. */
function dataToFields(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data };
}

/** Build full envelope JSON string from form fields + metadata. */
function fieldsToJson(
  fields: Record<string, unknown>,
  metadata: Record<string, unknown>,
): string {
  return JSON.stringify({ data: fields, metadata }, null, 2);
}

export function StartWorkflowPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: configsData, isLoading } = useWorkflowConfigs();
  const invokeMutation = useInvokeWorkflow();
  const [jsonInput, setJsonInput] = useState(DEFAULT_ENVELOPE);
  const [parseError, setParseError] = useState('');
  const [formFields, setFormFields] = useState<Record<string, unknown>>({});
  const [isJsonMode, setIsJsonMode] = useState(false);

  const selectedType = searchParams.get('type') ?? '';

  const configs: LTWorkflowConfig[] = configsData ?? [];

  const invocableConfigs = configs.filter((c) => c.invocable);
  const selectedConfig = configs.find((c) => c.workflow_type === selectedType);

  // Derive data field schema from envelope_schema
  const dataFields = useMemo(
    () => extractDataFields(selectedConfig?.envelope_schema ?? null),
    [selectedConfig?.envelope_schema],
  );

  const hasFormView = dataFields.length > 0;

  // Extract metadata from envelope_schema (kept separate, not editable via form)
  const schemaMetadata = useMemo(() => {
    if (!selectedConfig?.envelope_schema) return {};
    const md = selectedConfig.envelope_schema.metadata;
    return md && typeof md === 'object' ? (md as Record<string, unknown>) : {};
  }, [selectedConfig?.envelope_schema]);

  // Auto-select first workflow if only one exists and no type param
  useEffect(() => {
    if (
      invocableConfigs.length === 1 &&
      !searchParams.get('type')
    ) {
      setSearchParams(
        { type: invocableConfigs[0].workflow_type },
        { replace: true },
      );
    }
  }, [invocableConfigs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync envelope editor when selection changes
  useEffect(() => {
    if (!selectedConfig) return;
    setParseError('');
    invokeMutation.reset();

    const json = selectedConfig.envelope_schema
      ? JSON.stringify(selectedConfig.envelope_schema, null, 2)
      : DEFAULT_ENVELOPE;
    setJsonInput(json);

    // Populate form fields from schema data
    if (selectedConfig.envelope_schema?.data && typeof selectedConfig.envelope_schema.data === 'object') {
      setFormFields(dataToFields(selectedConfig.envelope_schema.data as Record<string, unknown>));
    } else {
      setFormFields({});
    }

    // Default to form view when schema has data fields, otherwise JSON view
    setIsJsonMode(!extractDataFields(selectedConfig.envelope_schema ?? null).length);
  }, [selectedType]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (config: LTWorkflowConfig) => {
    setSearchParams({ type: config.workflow_type }, { replace: true });
  };

  const handleToggleMode = () => {
    if (isJsonMode) {
      // Switching JSON -> Form: parse JSON and populate form fields
      try {
        const parsed = JSON.parse(jsonInput);
        if (parsed.data && typeof parsed.data === 'object') {
          setFormFields(dataToFields(parsed.data));
        }
      } catch {
        // If JSON is invalid, keep existing form fields
      }
    } else {
      // Switching Form -> JSON: sync form fields into JSON
      setJsonInput(fieldsToJson(formFields, schemaMetadata));
    }
    setIsJsonMode(!isJsonMode);
  };

  const updateFormField = (key: string, value: unknown, type: string) => {
    let parsed = value;
    if (type === 'number') parsed = value === '' ? 0 : Number(value);
    else if (type === 'boolean') parsed = value === 'true' || value === true;
    const updated = { ...formFields, [key]: parsed };
    setFormFields(updated);
    // Keep JSON in sync so invoking always has latest data
    setJsonInput(fieldsToJson(updated, schemaMetadata));
  };

  const handleInvoke = async () => {
    if (!selectedType) return;

    setParseError('');

    // Always use jsonInput as source of truth — it stays synced in both modes
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(jsonInput);
    } catch {
      setParseError('Invalid JSON');
      return;
    }

    // The editor holds the full envelope { data, metadata }.
    // Destructure so the API receives them as separate fields.
    const { data, metadata } = envelope;
    if (!data || typeof data !== 'object') {
      setParseError('Envelope must include a "data" object');
      return;
    }

    try {
      await invokeMutation.mutateAsync({
        workflowType: selectedType,
        data: data as Record<string, unknown>,
        metadata: (metadata as Record<string, unknown>) ?? undefined,
      });
      navigate(`/workflows/executions`);
    } catch {
      // Error is available via invokeMutation.error
    }
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Start" />

      {invocableConfigs.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-text-primary mb-1">No invocable workflows</p>
          <p className="text-xs text-text-tertiary">
            Mark workflows as invocable in Workflow Configs to enable them here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Workflow selector */}
          <div>
            <SectionLabel className="mb-6">Select Workflow</SectionLabel>
            <div>
              {invocableConfigs.map((config) => {
                const isSelected = selectedType === config.workflow_type;
                const hasTemplate = !!config.envelope_schema;
                return (
                  <button
                    key={config.workflow_type}
                    onClick={() => handleSelect(config)}
                    className={`w-full text-left py-4 border-b border-surface-border transition-colors duration-150 ${
                      isSelected
                        ? 'border-l-2 border-l-accent pl-4'
                        : 'pl-0 hover:text-text-primary'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-mono ${isSelected ? 'font-medium text-accent' : 'text-text-secondary'}`}>
                        {config.workflow_type}
                      </p>
                      {hasTemplate && (
                        <span className="px-1.5 py-0.5 text-[9px] bg-accent/10 text-accent rounded">
                          template
                        </span>
                      )}
                    </div>
                    {config.description && (
                      <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">
                        {config.description}
                      </p>
                    )}
                    <p className="text-[10px] text-text-tertiary mt-1 opacity-60">
                      {config.task_queue}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selectedType && selectedConfig ? (
              <div className="space-y-6">
                {/* Header with roles */}
                <div>
                  <div className="flex items-center justify-between">
                    <SectionLabel>{selectedType}</SectionLabel>
                    <div className="flex gap-2">
                      {selectedConfig.roles.map((r) => (
                        <Pill key={r}>{r}</Pill>
                      ))}
                    </div>
                  </div>
                  {selectedConfig.description && (
                    <p className="text-sm text-text-secondary mt-2 leading-relaxed">
                      {selectedConfig.description}
                    </p>
                  )}
                </div>

                {/* Envelope editor */}
                <div>
                  <div className="flex items-baseline justify-between mb-2">
                    <label className="block text-xs text-text-secondary">
                      Envelope
                    </label>
                    <div className="flex items-center gap-3">
                      {hasFormView && (
                        <button
                          type="button"
                          onClick={handleToggleMode}
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
                      onChange={(e) => {
                        setJsonInput(e.target.value);
                        setParseError('');
                      }}
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
                                  updateFormField(key, e.target.value, type)
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
                                    updateFormField(
                                      key,
                                      JSON.parse(e.target.value),
                                      type,
                                    );
                                  } catch {
                                    setFormFields({
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
                                  updateFormField(key, e.target.value, type)
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

                {/* Errors / success */}
                {parseError && (
                  <p className="text-xs text-status-error">{parseError}</p>
                )}
                {invokeMutation.error && (
                  <p className="text-xs text-status-error">
                    {invokeMutation.error.message}
                  </p>
                )}
                {invokeMutation.isSuccess && (
                  <p className="text-xs text-status-success">
                    Workflow started
                  </p>
                )}

                <button
                  onClick={handleInvoke}
                  disabled={invokeMutation.isPending}
                  className="btn-primary"
                >
                  {invokeMutation.isPending ? 'Starting...' : 'Start Workflow'}
                </button>
              </div>
            ) : (
              <div className="py-16 text-center">
                <p className="text-sm text-text-tertiary">
                  Select a workflow to begin
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
