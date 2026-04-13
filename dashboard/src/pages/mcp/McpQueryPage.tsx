import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Wand2, Zap, Layers, Circle } from 'lucide-react';

import { PageHeader } from '../../components/common/layout/PageHeader';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { TimestampCell } from '../../components/common/display/TimestampCell';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';
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

const columns: Column<LTJob>[] = [
  {
    key: 'entity',
    label: 'Workflow Type',
    className: 'whitespace-nowrap',
    render: (row) => {
      const s = mapStatus(row);
      const dotColor = s === 'completed' ? 'fill-status-success text-status-success'
        : s === 'in_progress' ? 'fill-status-active text-status-active animate-pulse'
        : 'fill-status-error text-status-error';
      return (
        <span className="inline-flex items-center gap-2">
          <Circle className={`w-2.5 h-2.5 shrink-0 ${dotColor}`} />
          <WorkflowPill type={(row as any).entity || 'unknown'} />
        </span>
      );
    },
  },
  {
    key: 'workflow_id',
    label: 'Workflow ID',
    render: (row) => (
      <span className="text-xs font-mono text-text-primary truncate block">
        {row.workflow_id}
      </span>
    ),
  },
  {
    key: 'created_at',
    label: 'Created',
    className: 'w-36',
    sortable: true,
    render: (row) => <TimestampCell date={row.created_at} />,
  },
  {
    key: 'updated_at',
    label: 'Updated',
    className: 'w-36',
    render: (row) => <TimestampCell date={row.updated_at} />,
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

const LIFECYCLE_STEPS = [
  {
    icon: Wand2,
    color: 'text-accent',
    title: '1. Describe',
    detail: 'Write a specific prompt. Mention tools, URLs, credentials, and expected outputs.',
  },
  {
    icon: Zap,
    color: 'text-status-warning',
    title: '2. Discover',
    detail: 'MCP selects servers, calls tools, and chains results. You review the execution.',
  },
  {
    icon: Layers,
    color: 'text-status-success',
    title: '3. Compile',
    detail: 'Successful runs compile into deterministic pipelines. No LLM needed at runtime.',
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

      <p className="text-sm text-text-secondary mb-8 leading-relaxed max-w-xl">
        Describe a task and MCP discovers the right tools, executes the workflow, and compiles the result into a reusable pipeline.
      </p>

      {/* Composer: textarea left, lifecycle steps right */}
      <div className="grid grid-cols-[1fr_240px] gap-6 mb-10">
        {/* Prompt input */}
        <form onSubmit={handleSubmit}>
          <div className="rounded-lg border border-surface-border bg-surface-raised overflow-hidden h-full flex flex-col">
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="Describe what you want to accomplish. Be specific about which tools to use, what data to capture, and how results should be structured..."
              className="flex-1 min-h-[160px] px-4 py-3 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none border-none"
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
                  className="px-4 py-1.5 bg-accent text-white text-xs font-medium rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

        {/* Lifecycle steps — right sidebar */}
        <div className="space-y-4 pt-1">
          {LIFECYCLE_STEPS.map((step) => (
            <div key={step.title} className="flex items-start gap-2.5">
              <step.icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${step.color}`} strokeWidth={1.5} />
              <div>
                <p className="text-[11px] font-medium text-text-primary">{step.title}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

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
