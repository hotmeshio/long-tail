import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkflowConfigs, useInvokeWorkflow } from '../../../api/workflows';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { SectionLabel } from '../../../components/common/layout/SectionLabel';
import { Pill } from '../../../components/common/display/Pill';
import type { LTWorkflowConfig } from '../../../api/types';
import {
  DEFAULT_ENVELOPE,
  extractDataFields,
  dataToFields,
  fieldsToJson,
} from './helpers';
import { WorkflowSelector } from './WorkflowSelector';
import { EnvelopeEditor } from './EnvelopeEditor';

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

  const handleJsonChange = (value: string) => {
    setJsonInput(value);
    setParseError('');
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
          <WorkflowSelector
            configs={invocableConfigs}
            selectedType={selectedType}
            onSelect={handleSelect}
          />

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
                <EnvelopeEditor
                  selectedConfig={selectedConfig}
                  isJsonMode={isJsonMode}
                  hasFormView={hasFormView}
                  jsonInput={jsonInput}
                  formFields={formFields}
                  dataFields={dataFields}
                  onJsonChange={handleJsonChange}
                  onToggleMode={handleToggleMode}
                  onUpdateFormField={updateFormField}
                  onSetFormFields={setFormFields}
                />

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
