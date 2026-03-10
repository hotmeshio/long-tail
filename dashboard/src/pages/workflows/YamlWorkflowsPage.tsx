import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useYamlWorkflows } from '../../api/yaml-workflows';
import { useFilterParams } from '../../hooks/useFilterParams';
import { StatusBadge } from '../../components/common/StatusBadge';
import { TimeAgo } from '../../components/common/TimeAgo';
import { PageHeader } from '../../components/common/PageHeader';
import { FilterBar, FilterSelect, FilterInput } from '../../components/common/FilterBar';
import { EmptyState } from '../../components/common/EmptyState';
import type { LTYamlWorkflowRecord } from '../../api/types';

// ── Grouped data ─────────────────────────────────────────────────────────────

interface ProcessServer {
  appId: string;
  workflows: LTYamlWorkflowRecord[];
  toolCount: number;
  status: string;
  updatedAt: string;
}

function groupByAppId(workflows: LTYamlWorkflowRecord[]): ProcessServer[] {
  const map = new Map<string, LTYamlWorkflowRecord[]>();
  for (const wf of workflows) {
    const list = map.get(wf.app_id) ?? [];
    list.push(wf);
    map.set(wf.app_id, list);
  }

  return [...map.entries()].map(([appId, wfs]) => {
    // Overall status: active > deployed > draft > archived
    const statusPriority: Record<string, number> = { active: 0, deployed: 1, draft: 2, archived: 3 };
    const bestStatus = wfs.reduce(
      (best, wf) => ((statusPriority[wf.status] ?? 9) < (statusPriority[best] ?? 9) ? wf.status : best),
      wfs[0].status,
    );
    const latest = wfs.reduce((max, wf) => (wf.updated_at > max ? wf.updated_at : max), wfs[0].updated_at);

    return {
      appId,
      workflows: wfs,
      toolCount: wfs.length,
      status: bestStatus,
      updatedAt: latest,
    };
  });
}

/** Client-side search: match server name or any tool's graph_topic/description */
function matchesSearch(server: ProcessServer, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  if (server.appId.toLowerCase().includes(q)) return true;
  return server.workflows.some(
    (wf) =>
      wf.graph_topic.toLowerCase().includes(q) ||
      wf.name?.toLowerCase().includes(q) ||
      wf.description?.toLowerCase().includes(q),
  );
}

/** Filter tools within a server that match the search term */
function filterTools(workflows: LTYamlWorkflowRecord[], search: string): LTYamlWorkflowRecord[] {
  if (!search) return workflows;
  const q = search.toLowerCase();
  return workflows.filter(
    (wf) =>
      wf.graph_topic.toLowerCase().includes(q) ||
      wf.name?.toLowerCase().includes(q) ||
      wf.description?.toLowerCase().includes(q),
  );
}

// ── Tool row (individual workflow inside expanded server) ─────────────────────

function ToolRow({ wf, onClick }: { wf: LTYamlWorkflowRecord; onClick: () => void }) {
  const stepCount = wf.activity_manifest.filter((a) => a.type === 'worker').length;

  return (
    <tr onClick={onClick} className="cursor-pointer row-hover">
      <td className="pl-14 pr-6 py-2">
        <div className="min-w-0">
          <code className="text-xs font-mono text-accent-primary">{wf.graph_topic}</code>
          {wf.description && (
            <p className="text-[10px] text-text-tertiary mt-0.5 line-clamp-1">{wf.description}</p>
          )}
        </div>
      </td>
      <td className="px-6 py-2">
        <span className="font-mono text-xs text-text-secondary">{wf.source_workflow_type ?? '—'}</span>
      </td>
      <td className="px-6 py-2 text-right">
        <span className="text-xs text-text-tertiary">
          {stepCount} step{stepCount !== 1 ? 's' : ''}
        </span>
      </td>
      <td className="px-6 py-2 w-28">
        <StatusBadge status={wf.status} />
      </td>
    </tr>
  );
}

// ── Server row (expandable namespace) ────────────────────────────────────────

function ServerRow({
  server,
  expanded,
  onToggle,
  onToolClick,
  visibleTools,
}: {
  server: ProcessServer;
  expanded: boolean;
  onToggle: () => void;
  onToolClick: (wf: LTYamlWorkflowRecord) => void;
  visibleTools: LTYamlWorkflowRecord[];
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="group/row border-b transition-colors duration-100 cursor-pointer row-hover"
      >
        {/* Expand chevron + name */}
        <td className="px-6 py-3.5">
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''} text-text-tertiary`}>
              <ChevronRight size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-text-primary font-medium font-mono">{server.appId}</p>
            </div>
          </div>
        </td>

        {/* Status */}
        <td className="px-6 py-3.5 w-32">
          <StatusBadge status={server.status} />
        </td>

        {/* Tool count */}
        <td className="px-6 py-3.5 w-24">
          <span className="text-xs text-text-tertiary">
            {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
          </span>
        </td>

        {/* Updated */}
        <td className="px-6 py-3.5 w-28">
          <TimeAgo date={server.updatedAt} />
        </td>
      </tr>

      {/* Animated tool panel */}
      <tr>
        <td colSpan={4} className="p-0 border-0">
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-in-out"
            style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-sunken/40">
                    <th className="pl-14 pr-6 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                      Tool
                    </th>
                    <th className="px-6 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                      Source
                    </th>
                    <th className="px-6 py-1.5 text-right text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                      Steps
                    </th>
                    <th className="px-6 py-1.5 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-28">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTools.map((wf) => (
                    <ToolRow key={wf.id} wf={wf} onClick={() => onToolClick(wf)} />
                  ))}
                </tbody>
              </table>
              <div className="h-1 bg-surface-sunken/20" />
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

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

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (appId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Workflow Tools" />
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
      <PageHeader title="Workflow Tools" />

      <p className="text-sm text-text-secondary mb-6 max-w-2xl leading-relaxed">
        Compiled from successful triage runs. Each workflow is a deterministic tool — no LLM, direct tool-to-tool piping.
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

      {filteredServers.length === 0 ? (
        <EmptyState title="No workflow tools found" />
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                Server
              </th>
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-32">
                Status
              </th>
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-24">
                Tools
              </th>
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-28">
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredServers.map((server) => (
              <ServerRow
                key={server.appId}
                server={server}
                expanded={expandedIds.has(server.appId)}
                onToggle={() => toggleExpand(server.appId)}
                onToolClick={(wf) => navigate(`/mcp/workflows/${wf.id}`)}
                visibleTools={filterTools(server.workflows, filters.search)}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
