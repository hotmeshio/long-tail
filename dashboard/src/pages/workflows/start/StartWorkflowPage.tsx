import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkflowConfigs, useDiscoveredWorkflows, useCronStatus } from '../../../api/workflows';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import type { LTWorkflowConfig } from '../../../api/types';
import { ModeToggle } from './ModeToggle';
import type { Mode } from './ModeToggle';
import { WorkflowSelector } from './WorkflowSelector';
import { StartNowPanel } from './StartNowPanel';
import { SchedulePanel } from './SchedulePanel';

export type InvokeTier = 'certified' | 'durable';

export function StartWorkflowPage({ tier: _tier }: { tier?: InvokeTier }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: configsData, isLoading } = useWorkflowConfigs();
  const { data: discoveredData, isLoading: discoveredLoading } = useDiscoveredWorkflows();
  const { data: cronEntries } = useCronStatus();

  const mode = (searchParams.get('mode') as Mode) || 'now';
  const selectedType = searchParams.get('type') ?? '';

  const configs: LTWorkflowConfig[] = configsData ?? [];

  const certifiedTypes = useMemo(
    () => new Set(configs.filter((c) => c.invocable).map((c) => c.workflow_type)),
    [configs],
  );

  const invocableConfigs = useMemo(() => {
    const certified = configs.filter((c) => c.invocable);
    const registeredTypes = new Set(configs.map((c) => c.workflow_type));
    const discovered = discoveredData ?? [];
    const durable = discovered
      .filter((dw) => dw.active && !registeredTypes.has(dw.workflow_type))
      .map((dw) => ({
        workflow_type: dw.workflow_type,
        task_queue: dw.task_queue ?? '',
        invocable: true,
        description: null,
        default_role: 'reviewer',
        roles: [],
        invocation_roles: [],
        consumes: [],
        envelope_schema: null,
        resolver_schema: null,
        cron_schedule: null,
        execute_as: null,
      } satisfies LTWorkflowConfig));
    return [...certified, ...durable];
  }, [configs, discoveredData]);

  const selectedConfig = invocableConfigs.find((c) => c.workflow_type === selectedType);

  const activeTypes = new Set(
    (cronEntries ?? []).filter((e) => e.active).map((e) => e.workflow_type),
  );

  const executionsPath = '/workflows/executions';

  useEffect(() => {
    if (invocableConfigs.length === 1 && !searchParams.get('type')) {
      setSearchParams({ type: invocableConfigs[0].workflow_type, mode }, { replace: true });
    }
  }, [invocableConfigs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMode = (m: Mode) => {
    const params: Record<string, string> = { mode: m };
    if (selectedType) params.type = selectedType;
    setSearchParams(params, { replace: true });
  };

  const handleSelect = (config: LTWorkflowConfig) => {
    setSearchParams({ type: config.workflow_type, mode }, { replace: true });
  };

  if (isLoading || discoveredLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-40 bg-surface-sunken rounded" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Invoke Workflow"
        actions={<ModeToggle mode={mode} onChange={setMode} />}
      />

      {invocableConfigs.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-text-primary mb-1">No invocable workflows</p>
          <p className="text-xs text-text-tertiary">Mark workflows as invocable in the registry, or start the server with examples enabled.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          <WorkflowSelector
            configs={invocableConfigs}
            selectedType={selectedType}
            onSelect={handleSelect}
            certifiedTypes={certifiedTypes}
          />

          <div className="lg:col-span-2">
            {selectedType && selectedConfig ? (
              mode === 'now' ? (
                <StartNowPanel selected={selectedConfig} executionsPath={executionsPath} />
              ) : (
                <SchedulePanel selected={selectedConfig} activeTypes={activeTypes} />
              )
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
