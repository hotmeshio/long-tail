import { useNavigate } from 'react-router-dom';
import { Wand2, Workflow } from 'lucide-react';
import { useYamlWorkflows } from '../../api/yaml-workflows';
import { useSettings } from '../../api/settings';
import { useFilterParams } from '../../hooks/useFilterParams';

import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect, FilterInput } from '../../components/common/data/FilterBar';
import { EmptyState } from '../../components/common/display/EmptyState';
import { ToolPill } from '../../components/common/display/ToolPill';
import { NamespacePill } from '../../components/common/display/NamespacePill';
import { StatusBadge } from '../../components/common/display/StatusBadge';

// ── Page: Graph › Configure ─────────────────────────────────────────────────

export function YamlWorkflowsPage() {
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const aiEnabled = !!settings?.ai?.enabled;
  const { filters, setFilter } = useFilterParams({
    filters: { status: '', search: '' },
  });

  const { data, isLoading } = useYamlWorkflows({
    status: (filters.status || undefined) as any,
    search: filters.search || undefined,
    limit: 200,
    offset: 0,
  });

  const flows = data?.workflows ?? [];

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Configure" docsHash="#docs:dashboard.md:graph-workflows" />
        <div className="animate-pulse space-y-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 border-b last:border-b-0 px-6 flex items-center">
              <div className="h-3 bg-surface-sunken rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Configure"
        docsHash="#docs:dashboard.md:graph-workflows"
        actions={
          aiEnabled ? (
            <button onClick={() => navigate('/mcp/queries/new')} className="btn-primary text-xs">
              Design Flow
            </button>
          ) : undefined
        }
      />

      <p className="text-sm text-text-secondary mb-6 max-w-2xl leading-relaxed">
        The compiled form of a durable workflow — the same guarantees at roughly 3× the speed. Each
        flow is a graph the router discovers and runs on demand. Open one to inspect or run it
        {aiEnabled ? ', or design a new one from a description.' : '.'}
      </p>

      <FilterBar>
        <FilterInput
          label="Search"
          value={filters.search}
          onChange={(v) => setFilter('search', v)}
          placeholder="Flow or namespace…"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={[
            { value: 'draft', label: 'Draft' },
            { value: 'deployed', label: 'Deployed' },
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </FilterBar>

      {flows.length === 0 ? (
        aiEnabled ? (
          <div className="cursor-pointer" onClick={() => navigate('/mcp/queries/new')}>
            <EmptyState
              icon={Wand2}
              title="No graph flows yet"
              description="Open the Designer to compile your first flow from a description, or register flows at startup with the graphWorkflows config."
            />
          </div>
        ) : (
          <EmptyState
            icon={Workflow}
            title="No graph flows yet"
            description="Register graph flows at startup with the graphWorkflows config — see the docs for an example."
          />
        )
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="px-6 py-3 text-left text-2xs font-semibold uppercase tracking-widest text-text-tertiary">
                Flow
              </th>
              <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-widest text-text-tertiary w-40">
                Namespace
              </th>
              <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-widest text-text-tertiary w-20">
                Version
              </th>
              <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-widest text-text-tertiary w-28">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {flows.map((flow) => (
              <tr
                key={flow.id}
                onClick={() => navigate(`/mcp/workflows/${flow.id}`)}
                className="border-b border-surface-border/50 hover:bg-surface-hover/40 transition-colors duration-100 cursor-pointer"
              >
                <td className="px-6 py-2.5">
                  <ToolPill name={flow.graph_topic} size="md" />
                  {flow.description && (
                    <p className="text-2xs leading-snug text-text-quaternary mt-0.5">{flow.description}</p>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <NamespacePill namespace={flow.app_id} />
                </td>
                <td className="px-4 py-2.5 text-2xs text-text-quaternary font-mono whitespace-nowrap">
                  v{flow.content_version}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <StatusBadge status={flow.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
