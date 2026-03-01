import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkflowConfigs, useInvokeWorkflow } from '../../api/workflows';
import { getInvocationTemplate } from '../../lib/templates';
import { PageHeader } from '../../components/common/PageHeader';
import { SectionLabel } from '../../components/common/SectionLabel';
import { Pill } from '../../components/common/Pill';
import type { LTWorkflowConfig } from '../../api/types';

export function StartWorkflowPage() {
  const navigate = useNavigate();
  const { data: configsData, isLoading } = useWorkflowConfigs();
  const invokeMutation = useInvokeWorkflow();
  const [selectedType, setSelectedType] = useState('');
  const [jsonInput, setJsonInput] = useState('{\n  \n}');
  const [parseError, setParseError] = useState('');

  const configs: LTWorkflowConfig[] = configsData ?? [];

  const invocableConfigs = configs.filter((c) => c.invocable);
  const selectedConfig = configs.find((c) => c.workflow_type === selectedType);

  const handleInvoke = async () => {
    if (!selectedType) return;

    setParseError('');
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(jsonInput);
    } catch {
      setParseError('Invalid JSON');
      return;
    }

    try {
      await invokeMutation.mutateAsync({
        workflowType: selectedType,
        data,
      });
      navigate(`/workflows/list`);
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
      <PageHeader title="Start Workflow" />

      {invocableConfigs.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-text-primary mb-1">No invocable workflows</p>
          <p className="text-xs text-text-tertiary">
            Mark workflows as invocable in the admin config to enable them here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Workflow selector — airy list */}
          <div>
            <SectionLabel className="mb-6">Select Workflow</SectionLabel>
            <div>
              {invocableConfigs.map((config) => {
                const isSelected = selectedType === config.workflow_type;
                return (
                  <button
                    key={config.workflow_type}
                    onClick={() => {
                      setSelectedType(config.workflow_type);
                      setJsonInput(getInvocationTemplate(config.workflow_type));
                    }}
                    className={`w-full text-left py-4 border-b border-surface-border transition-colors duration-150 ${
                      isSelected
                        ? 'border-l-2 border-l-accent pl-4 text-accent'
                        : 'pl-0 text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <p className={`text-sm font-mono ${isSelected ? 'font-medium' : ''}`}>
                      {config.workflow_type}
                    </p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      Queue: {config.task_queue} &middot; Role: {config.default_role}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selectedType ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <SectionLabel>{selectedType}</SectionLabel>
                  {selectedConfig && (
                    <div className="flex gap-2">
                      {selectedConfig.roles.map((r) => (
                        <Pill key={r}>{r}</Pill>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-text-secondary mb-2">
                    Envelope Data (JSON)
                  </label>
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
                </div>

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
