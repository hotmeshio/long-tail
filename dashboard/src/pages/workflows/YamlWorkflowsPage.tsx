import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Play } from 'lucide-react';
import { useYamlWorkflows } from '../../api/yaml-workflows';
import { useFilterParams } from '../../hooks/useFilterParams';
import { StatusBadge } from '../../components/common/display/StatusBadge';

import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect, FilterInput } from '../../components/common/data/FilterBar';
import { EmptyState } from '../../components/common/display/EmptyState';
import { TryWorkflowModal } from './yaml-workflow-detail/TryWorkflowModal';
import { groupByAppId, matchesSearch, filterTools, type ProcessServer } from './yaml-helpers';
import type { LTYamlWorkflowRecord } from '../../api/types';

// ── Tool row (individual workflow inside expanded server) ─────────────────────

function ToolRow({ wf, onClick, onTry }: { wf: LTYamlWorkflowRecord; onClick: () => void; onTry: () => void }) {
  const canTry = wf.status === 'active';

  return (
    <div onClick={onClick} className="group/row flex items-center cursor-pointer hover:bg-surface-hover/50 transition-colors border-b border-surface-border/30">
      {/* Tool name — indented to align under server name */}
      <div className="flex-1 pl-14 pr-6 py-2 min-w-0">
        <code className="text-xs font-mono text-accent-primary truncate block">{wf.graph_topic}</code>
        {wf.description && (
          <p className="text-[10px] text-text-tertiary mt-0.5 line-clamp-1">{wf.description}</p>
        )}
      </div>
      {/* Status */}
      <div className="w-28 px-6 py-2 whitespace-nowrap shrink-0">
        <StatusBadge status={wf.status} />
      </div>
      {/* Try — hover-reveal icon */}
      <div className="w-12 px-3 py-2 flex justify-end shrink-0">
        {canTry && (
          <button
            onClick={(e) => { e.stopPropagation(); onTry(); }}
            className="opacity-0 group-hover/row:opacity-100 transition-opacity text-text-tertiary hover:text-accent"
            title="Try tool"
          >
            <Play className="w-[18px] h-[18px]" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Server row (expandable namespace) ────────────────────────────────────────

function ServerRow({
  server,
  expanded,
  onToggle,
  onToolClick,
  onTryTool,
  visibleTools,
}: {
  server: ProcessServer;
  expanded: boolean;
  onToggle: () => void;
  onToolClick: (wf: LTYamlWorkflowRecord) => void;
  onTryTool: (wf: LTYamlWorkflowRecord) => void;
  visibleTools: LTYamlWorkflowRecord[];
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="group/row border-b transition-colors duration-100 cursor-pointer row-hover"
      >
        {/* Name + badge + timestamp */}
        <td className="px-6 py-3.5">
          <div className="flex items-center gap-2">
            <span className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''} text-text-tertiary`}>
              <ChevronRight size={14} />
            </span>
            <p className="text-sm text-text-primary font-medium font-mono">{server.appId}</p>
          </div>
        </td>

        {/* Status */}
        <td className="px-6 py-3.5 w-28 whitespace-nowrap">
          <StatusBadge status={server.status} />
        </td>

        {/* Tool count badge — aligned with child row hover icons */}
        <td className="w-12 text-center">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-accent/30 text-[10px] font-medium text-accent">
            {server.toolCount}
          </span>
        </td>
      </tr>

      {/* Expanded tool rows — no sub-header, aligned to outer columns */}
      <tr>
        <td colSpan={5} className="p-0 border-0">
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-in-out"
            style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              {visibleTools.map((wf) => (
                <ToolRow key={wf.id} wf={wf} onClick={() => onToolClick(wf)} onTry={() => onTryTool(wf)} />
              ))}
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
  const [tryWorkflow, setTryWorkflow] = useState<LTYamlWorkflowRecord | null>(null);

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
        <PageHeader title="MCP Pipeline Tools" />
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
        actions={
          <button onClick={() => navigate('/mcp/queries')} className="btn-primary text-xs">
            Design Pipeline
          </button>
        }
      />

      <p className="text-sm text-text-secondary mb-6 max-w-2xl leading-relaxed">
        Compiled from successful triage runs. Each workflow is a deterministic tool.
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
                Server / Tool
              </th>
              <th className="sticky top-[2.75rem] z-10 bg-surface px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-tertiary w-28">
                Status
              </th>
              <th className="sticky top-[2.75rem] z-10 bg-surface w-12" />
            </tr>
          </thead>
          <tbody>
            {filteredServers.map((server) => (
              <ServerRow
                key={server.appId}
                server={server}
                expanded={expandedIds.has(server.appId)}
                onToggle={() => toggleExpand(server.appId)}
                onToolClick={(wf) => navigate(
                  wf.source_workflow_id
                    ? `/mcp/queries/${wf.source_workflow_id}`
                    : `/mcp/workflows/${wf.id}`
                )}
                onTryTool={(wf) => setTryWorkflow(wf)}
                visibleTools={filterTools(server.workflows, filters.search)}
              />
            ))}
          </tbody>
        </table>
      )}

      {tryWorkflow && (
        <TryWorkflowModal
          open={!!tryWorkflow}
          onClose={() => setTryWorkflow(null)}
          workflow={tryWorkflow}
        />
      )}
    </div>
  );
}
