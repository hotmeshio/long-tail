import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Play } from 'lucide-react';
import { useYamlWorkflows } from '../../api/yaml-workflows';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { WorkflowTestPanel } from '../../components/common/test/WorkflowTestPanel';
import { GraphFlowSelector } from './GraphFlowSelector';

export function GraphInvokePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id') ?? '';

  const { data, isLoading } = useYamlWorkflows({ status: 'active' as any, limit: 200, offset: 0 });
  const flows = data?.workflows ?? [];
  const selected = flows.find((f) => f.id === selectedId) ?? null;

  // Auto-select when there's exactly one flow
  useEffect(() => {
    if (flows.length === 1 && !searchParams.get('id')) {
      setSearchParams({ id: flows[0].id }, { replace: true });
    }
  }, [flows.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <PageHeader title="Invoke" docsHash="#docs:dashboard.md:graph-workflows" />

      {flows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-text-primary mb-1">No active graph flows</p>
          <p className="text-xs text-text-tertiary">
            Register graph flows at startup with the graphWorkflows config, or deploy one from Configure.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-8 items-start">
          <div className="col-span-2">
            <GraphFlowSelector
              flows={flows}
              selectedId={selectedId}
              onSelect={(f) => setSearchParams({ id: f.id }, { replace: true })}
            />
          </div>

          <div className="sticky top-4 transition-all duration-200 ease-out">
            {selected ? (
              <WorkflowTestPanel
                workflow={selected}
                onClose={() => setSearchParams({}, { replace: true })}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <Play className="w-6 h-6 text-text-quaternary mb-3" strokeWidth={1} />
                <p className="text-sm text-text-tertiary">Select a flow</p>
                <p className="text-xs text-text-quaternary mt-1">Choose one from the list to run it.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
