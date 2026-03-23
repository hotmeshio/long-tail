import { useSearchParams } from 'react-router-dom';
import { useWorkflowConfigs, useCronStatus } from '../../../api/workflows';
import { PageHeader } from '../../../components/common/layout/PageHeader';
import { CronWorkflowSelector } from './CronWorkflowSelector';
import { CronDetailPanel } from './CronDetailPanel';

export function CronWorkflowsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: configs, isLoading } = useWorkflowConfigs();
  const { data: cronEntries } = useCronStatus();

  const selectedType = searchParams.get('type') ?? '';

  // All invocable workflows are candidates for cron
  const invocable = (configs ?? []).filter((c) => c.invocable);
  const selected = invocable.find((c) => c.workflow_type === selectedType);

  // Active cron types from the server-side registry
  const activeTypes = new Set(
    (cronEntries ?? []).filter((e) => e.active).map((e) => e.workflow_type),
  );

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
      <PageHeader title="Cron" />

      {invocable.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-text-primary mb-1">No invocable workflows</p>
          <p className="text-xs text-text-tertiary">
            Mark workflows as invocable in Workflow Configs to enable cron scheduling.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Workflow selector */}
          <CronWorkflowSelector
            workflows={invocable}
            selectedType={selectedType}
            activeTypes={activeTypes}
            onSelect={(type) => setSearchParams({ type }, { replace: true })}
          />

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selected ? (
              <CronDetailPanel selected={selected} activeTypes={activeTypes} />
            ) : (
              <div className="py-16 text-center">
                <p className="text-sm text-text-tertiary">
                  Select a workflow to configure its cron schedule
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
