import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Wand2, Zap, Layers } from 'lucide-react';

import { PageHeader } from '../../components/common/layout/PageHeader';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { StatusBadge } from '../../components/common/display/StatusBadge';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { EmptyState } from '../../components/common/display/EmptyState';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useWorkflowListEvents } from '../../hooks/useNatsEvents';
import { useMcpQueryJobs, useSubmitMcpQuery, useSubmitMcpQueryRouted } from '../../api/mcp-query';
import type { LTJob } from '../../api/types';

function mapStatus(job: LTJob): string {
  if (job.status === 'completed') return 'completed';
  if (Number(job.status) === 0) return 'completed';
  if (job.is_live) return 'in_progress';
  return 'failed';
}

function entityLabel(entity: string | undefined): { label: string; style: string } {
  switch (entity) {
    case 'mcpQuery':
      return { label: 'Query', style: 'bg-accent-primary/10 text-accent-primary' };
    case 'mcpTriage':
      return { label: 'Triage', style: 'bg-status-warning/10 text-status-warning' };
    default:
      return { label: entity || '—', style: 'bg-surface-sunken text-text-tertiary' };
  }
}

const columns: Column<LTJob>[] = [
  {
    key: 'status',
    label: 'Status',
    className: 'w-28 whitespace-nowrap',
    render: (row) => <StatusBadge status={mapStatus(row)} />,
  },
  {
    key: 'entity',
    label: 'Type',
    className: 'w-32 whitespace-nowrap',
    render: (row) => {
      const { label, style } = entityLabel((row as any).entity);
      return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style}`}>
          {label}
        </span>
      );
    },
  },
  {
    key: 'workflow_id',
    label: 'Run ID',
    render: (row) => (
      <span className="text-xs font-mono text-text-primary truncate max-w-[240px] block">
        {row.workflow_id}
      </span>
    ),
  },
  {
    key: 'created_at',
    label: 'Started',
    className: 'w-28 text-right',
    sortable: true,
    render: (row) => <span className="block text-right"><TimeAgo date={row.created_at} /></span>,
  },
  {
    key: 'updated_at',
    label: 'Updated',
    className: 'w-28 text-right',
    render: (row) => <span className="block text-right"><TimeAgo date={row.updated_at} /></span>,
  },
  {
    key: 'actions',
    label: '',
    className: 'w-10',
    render: () => (
      <span className="opacity-0 group-hover/row:opacity-100 transition-opacity text-text-tertiary hover:text-accent">
        <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
      </span>
    ),
  },
];

export function McpQueryPage() {
  const navigate = useNavigate();
  const [promptText, setPromptText] = useState('');
  const [direct, setDirect] = useState(true);
  const submitDirect = useSubmitMcpQuery();
  const submitRouted = useSubmitMcpQueryRouted();
  const activeMutation = direct ? submitDirect : submitRouted;

  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { search: '', status: '' },
    pageSize: 20,
  });

  const { data, isLoading } = useMcpQueryJobs({
    limit: pagination.pageSize,
    offset: pagination.offset,
    search: filters.search,
    status: filters.status,
  });

  useWorkflowListEvents();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = promptText.trim();
    if (!prompt) return;

    const result = await activeMutation.mutateAsync({ prompt });
    setPromptText('');
    if (direct) {
      navigate(`/mcp/queries/${result.workflow_id}?prompt=${encodeURIComponent(prompt)}`);
    } else {
      navigate(`/workflows/executions/${result.workflow_id}`);
    }
  };

  const jobs = data?.jobs ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <PageHeader title="Pipeline Designer" />

      <p className="text-sm text-text-secondary mb-6 max-w-2xl leading-relaxed">
        Describe a task and MCP discovers the right tools, executes the workflow, and compiles the result into a reusable pipeline.
      </p>

      {/* Design lifecycle steps */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="flex items-start gap-3 p-3 rounded-lg border border-surface-border bg-surface-raised/50">
          <Wand2 className="w-4 h-4 mt-0.5 text-accent shrink-0" />
          <div>
            <p className="text-xs font-medium text-text-primary">1. Describe</p>
            <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">Write a specific prompt. Mention tools, URLs, credentials, and expected outputs.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 rounded-lg border border-surface-border bg-surface-raised/50">
          <Zap className="w-4 h-4 mt-0.5 text-status-warning shrink-0" />
          <div>
            <p className="text-xs font-medium text-text-primary">2. Discover</p>
            <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">MCP selects servers, calls tools, and chains results. You review the execution.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 rounded-lg border border-surface-border bg-surface-raised/50">
          <Layers className="w-4 h-4 mt-0.5 text-status-success shrink-0" />
          <div>
            <p className="text-xs font-medium text-text-primary">3. Compile</p>
            <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">Successful runs compile into deterministic pipelines. No LLM needed at runtime.</p>
          </div>
        </div>
      </div>

      {/* Prompt input */}
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="rounded-lg border border-surface-border bg-surface-raised overflow-hidden">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Describe what you want to accomplish. Be specific about which tools to use, what data to capture, and how results should be structured..."
            className="w-full min-h-[100px] max-h-[200px] px-4 py-3 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none border-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSubmit(e);
              }
            }}
          />
          <div className="flex items-center justify-between px-4 py-2 border-t border-surface-border bg-surface-sunken/30">
            <label className="flex items-center gap-2 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={direct}
                onChange={(e) => setDirect(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border text-accent-primary focus:ring-accent-primary/50 bg-surface-sunken cursor-pointer"
              />
              <span className="text-[10px] text-text-secondary group-hover:text-text-primary transition-colors">
                Force discovery
              </span>
              <span className="text-[10px] text-text-tertiary">
                {direct ? '— skip compiled pipelines' : '— prefer compiled pipelines'}
              </span>
            </label>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-text-tertiary">Cmd+Enter</span>
              <button
                type="submit"
                disabled={!promptText.trim() || activeMutation.isPending}
                className="px-4 py-1.5 bg-accent-primary text-white text-xs font-medium rounded-md hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {activeMutation.isPending ? 'Starting...' : 'Design Pipeline'}
              </button>
            </div>
          </div>
        </div>
        {activeMutation.isError && (
          <p className="mt-2 text-sm text-status-error">{activeMutation.error.message}</p>
        )}
      </form>

      {/* Recent runs */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Recent Runs</p>
        <FilterBar>
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(v) => setFilter('status', v)}
            options={[
              { value: 'completed', label: 'Completed' },
              { value: 'running', label: 'Running' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        </FilterBar>
      </div>

      <DataTable
        columns={columns}
        data={jobs}
        keyFn={(row) => row.workflow_id}
        onRowClick={(row) => navigate(`/mcp/queries/${row.workflow_id}`)}
        isLoading={isLoading}
        emptyMessage=""
        sort={sort}
        onSort={setSort}
      />

      {!isLoading && jobs.length === 0 && (
        <EmptyState title="No pipeline runs yet" description="Describe a task above to start designing" />
      )}

      <StickyPagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={total}
        totalPages={pagination.totalPages(total)}
        onPageChange={pagination.setPage}
      />
    </>
  );
}
