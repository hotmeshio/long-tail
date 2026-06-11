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
      <PageHeader title="Invoke" docsHash="#docs:dashboard.md:mcp-pipeline-tools" />

      <p className="text-sm text-text-secondary mb-6 max-w-2xl leading-relaxed">
        Run a Graph flow — the compiled form of a durable workflow that the router discovers and
        executes on demand. The procedural form runs under Orchestrate › Procedural.
      </p>

      {flows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-text-primary mb-1">No active graph flows</p>
          <p className="text-xs text-text-tertiary">
            Register graph flows at startup with the graphWorkflows config, or deploy one from Configure.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <GraphFlowSelector
            flows={flows}
            selectedId={selectedId}
            onSelect={(f) => setSearchParams({ id: f.id }, { replace: true })}
          />

          <div className="lg:col-span-2">
            {selected ? (
              <WorkflowTestPanel
                workflow={selected}
                onClose={() => setSearchParams({}, { replace: true })}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-12 h-12 rounded-full bg-accent/[0.06] flex items-center justify-center mb-4">
                  <Play className="w-5 h-5 text-accent/50" />
                </div>
                <p className="text-sm text-text-secondary mb-1">Run</p>
                <p className="text-xs text-text-quaternary">Choose a flow to get started</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
