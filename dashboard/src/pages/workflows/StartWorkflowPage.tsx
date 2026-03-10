import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkflowConfigs, useInvokeWorkflow } from '../../api/workflows';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';
import { Pill } from '../../components/common/Pill';
import type { LTWorkflowConfig } from '../../api/types';

const DEFAULT_ENVELOPE = '{\n  "data": {},\n  "metadata": {}\n}';

export function StartWorkflowPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: configsData, isLoading } = useWorkflowConfigs();
  const invokeMutation = useInvokeWorkflow();
  const [jsonInput, setJsonInput] = useState(DEFAULT_ENVELOPE);
  const [parseError, setParseError] = useState('');

  const selectedType = searchParams.get('type') ?? '';

  const configs: LTWorkflowConfig[] = configsData ?? [];

  const invocableConfigs = configs.filter((c) => c.invocable);
  const selectedConfig = configs.find((c) => c.workflow_type === selectedType);

  // Sync envelope editor when selection changes
  useEffect(() => {
    if (!selectedConfig) return;
    setParseError('');
    invokeMutation.reset();
    setJsonInput(
      selectedConfig.envelope_schema
        ? JSON.stringify(selectedConfig.envelope_schema, null, 2)
        : DEFAULT_ENVELOPE,
    );
  }, [selectedType]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (config: LTWorkflowConfig) => {
    setSearchParams({ type: config.workflow_type }, { replace: true });
  };

  const handleInvoke = async () => {
    if (!selectedType) return;

    setParseError('');
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
      navigate(`/workflows/runs`);
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
                    <p className="text-xs text-text-tertiary mt-2">
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
                    {selectedConfig.envelope_schema ? (
                      <span className="text-[10px] text-accent">
                        Pre-filled from workflow config
                      </span>
                    ) : (
                      <span className="text-[10px] text-status-warning">
                        No template — configure one via Workflow Configs &rarr; Edit
                      </span>
                    )}
                  </div>
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
