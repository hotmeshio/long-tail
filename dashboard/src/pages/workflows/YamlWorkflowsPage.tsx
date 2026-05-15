import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useYamlWorkflows } from '../../api/yaml-workflows';
import { useWorkflowSets } from '../../api/workflow-sets';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useExpandedRows } from '../../hooks/useExpandedRows';

import { Wand2 } from 'lucide-react';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect, FilterInput } from '../../components/common/data/FilterBar';
import { EmptyState } from '../../components/common/display/EmptyState';
import { WorkflowTestPanel } from '../../components/common/test/WorkflowTestPanel';
import { CronPanel } from '../../components/common/test/CronPanel';
import { groupByAppId, matchesSearch, filterTools } from './yaml-helpers';
import { ServerRow } from './yaml-workflow-rows';
import type { LTYamlWorkflowRecord } from '../../api/types';

// ── Page ──────────────────────────────────────────────────────────────────────

export function YamlWorkflowsPage() {
  const navigate = useNavigate();
  const { filters, setFilter } = useFilterParams({
    filters: { status: '', server: '', search: '' },
  });

  // Fetch a larger page to get all workflows for grouping
  const { data, isLoading } = useYamlWorkflows({
    status: (filters.status || undefined) as any,
    app_id: filters.server || undefined,
    search: filters.search || undefined,
    limit: 200,
    offset: 0,
  });

  const workflows = data?.workflows ?? [];

  // Fetch workflow sets to resolve workbench links (set_id → planner workflow ID)
  const { data: setsData } = useWorkflowSets({ limit: 100 });
  const setSourceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of setsData?.sets ?? []) {
      if (s.source_workflow_id) map.set(s.id, s.source_workflow_id);
    }
    return map;
  }, [setsData?.sets]);

  const servers = useMemo(() => groupByAppId(workflows), [workflows]);

  // Build server options from unfiltered results; re-derive when status/search change
  const serverOptions = useMemo(() => {
    const ids = [...new Set(workflows.map((wf) => wf.app_id))].sort();
    return ids.map((id) => ({ value: id, label: id }));
  }, [workflows]);

  // Client-side search filtering for tool-level matches within expanded rows
  const filteredServers = useMemo(() => {
    if (!filters.search) return servers;
    return servers.filter((s) => matchesSearch(s, filters.search));
  }, [servers, filters.search]);

  const { expandedIds, toggle: toggleExpand } = useExpandedRows('lt:expanded:yaml-workflows');
  const [tryWorkflow, setTryWorkflow] = useState<LTYamlWorkflowRecord | null>(null);
  const [cronWorkflow, setCronWorkflow] = useState<LTYamlWorkflowRecord | null>(null);

  // Active sidebar: test panel or cron panel (mutually exclusive)
  const sidebarWorkflow = tryWorkflow || cronWorkflow;

  if (isLoading) {
    return (
      <div>
        <PageHeader title="MCP Pipeline Tools" docsHash="#docs:dashboard.md:mcp-pipeline-tools" />
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
        title="MCP Pipeline Tools"
        docsHash="#docs:dashboard.md:mcp-pipeline-tools"
        actions={
          <button onClick={() => navigate('/mcp/queries/new')} className="btn-primary text-xs">
            Design Pipeline
          </button>
        }
      />

      <p className="text-sm text-text-secondary mb-6 max-w-2xl leading-relaxed">
        Deterministic tools compiled from dynamic MCP executions. Each tool is a YAML DAG that the router discovers and invokes automatically.
      </p>

      <FilterBar>
        <FilterInput
          label="Search"
          value={filters.search}
          onChange={(v) => setFilter('search', v)}
          placeholder="Server or tool name…"
        />
        {serverOptions.length > 1 && (
          <FilterSelect
            label="Server"
            value={filters.server}
            onChange={(v) => setFilter('server', v)}
            options={serverOptions}
          />
        )}
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

      <div className="flex gap-0">
        <div className={`${sidebarWorkflow ? 'flex-1 min-w-0' : 'w-full'} transition-all`}>
          {filteredServers.length === 0 ? (
            <div className="cursor-pointer" onClick={() => navigate('/mcp/queries/new')}>
              <EmptyState icon={Wand2} title="No pipelines yet" description="Click to open the MCP Tool Designer and create your first deterministic tool." />
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                    Server / Tool
                  </th>
                  <th className="sticky top-[2.75rem] z-10 bg-surface px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-20">
                    Version
                  </th>
                  <th className="sticky top-[2.75rem] z-10 bg-surface px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-28">
                    Status
                  </th>
                  <th className="sticky top-[2.75rem] z-10 bg-surface w-16" />
                </tr>
              </thead>
              <tbody>
                {filteredServers.map((server) => (
                  <ServerRow
                    key={server.appId}
                    server={server}
                    expanded={expandedIds.has(server.appId)}
                    onToggle={() => toggleExpand(server.appId)}
                    onTryTool={(wf) => { setCronWorkflow(null); setTryWorkflow(wf); }}
                    onWorkbench={() => {
                      if (server.setId) {
                        const plannerWfId = setSourceMap.get(server.setId);
                        if (plannerWfId) {
                          navigate(`/mcp/queries/${plannerWfId}?mode=plan&set_id=${server.setId}&step=2`);
                        }
                      }
                    }}
                    onCron={(wf) => { setTryWorkflow(null); setCronWorkflow(wf); }}
                    visibleTools={filterTools(server.workflows, filters.search)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {tryWorkflow && (
          <div className="w-[380px] shrink-0 sticky top-0 max-h-screen overflow-y-auto">
            <WorkflowTestPanel
              workflow={tryWorkflow}
              onClose={() => setTryWorkflow(null)}
            />
          </div>
        )}

        {cronWorkflow && (
          <div className="w-[380px] shrink-0 sticky top-0 max-h-screen overflow-y-auto">
            <CronPanel
              workflow={cronWorkflow}
              onClose={() => setCronWorkflow(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
