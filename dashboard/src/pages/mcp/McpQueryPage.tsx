import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

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
      <PageHeader title="Invoke MCP Discovery Flow" />

      {/* Submit form */}
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-2">
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="Describe what you want to accomplish..."
              className="w-full min-h-[80px] max-h-[200px] px-4 py-3 bg-surface-sunken border border-border rounded-lg text-sm text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent-primary"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSubmit(e);
                }
              }}
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={direct}
                  onChange={(e) => setDirect(e.target.checked)}
                  className="w-4 h-4 rounded border-border text-accent-primary focus:ring-accent-primary/50 bg-surface-sunken cursor-pointer"
                />
                <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                  Force discovery
                </span>
                <span className="text-xs text-text-tertiary">
                  {direct
                    ? '— always run dynamic LLM exploration, skip compiled pipelines'
                    : '— use a compiled pipeline if one matches, otherwise discover dynamically'}
                </span>
              </label>
              <span className="text-xs text-text-tertiary">Cmd+Enter to submit</span>
            </div>
          </div>
          <button
            type="submit"
            disabled={!promptText.trim() || activeMutation.isPending}
            className="self-start px-6 py-3 bg-accent-primary text-white text-sm font-medium rounded-lg hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {activeMutation.isPending ? 'Starting...' : 'Run'}
          </button>
        </div>
        {activeMutation.isError && (
          <p className="mt-2 text-sm text-status-error">{activeMutation.error.message}</p>
        )}
      </form>

      {/* Filters */}
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

      {/* Table */}
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
        <EmptyState title="No queries yet" description="Submit a prompt above to get started" />
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
