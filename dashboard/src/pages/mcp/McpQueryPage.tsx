import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '../../components/common/layout/PageHeader';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { StatusBadge } from '../../components/common/display/StatusBadge';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { EmptyState } from '../../components/common/display/EmptyState';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useWorkflowListEvents } from '../../hooks/useNatsEvents';
import { useMcpQueryJobs, useSubmitMcpQuery } from '../../api/mcp-query';
import type { LTJob } from '../../api/types';

function mapStatus(job: LTJob): string {
  if (job.status === 'completed') return 'completed';
  if (Number(job.status) === 0) return 'completed';
  if (job.is_live) return 'in_progress';
  return 'failed';
}

const columns: Column<LTJob>[] = [
  {
    key: 'status',
    label: 'Status',
    className: 'w-28',
    render: (row) => <StatusBadge status={mapStatus(row)} />,
  },
  {
    key: 'workflow_id',
    label: 'Run ID',
    className: 'w-64',
    render: (row) => (
      <span className="text-xs font-mono text-text-primary truncate max-w-[240px] block">
        {row.workflow_id}
      </span>
    ),
  },
  {
    key: 'created_at',
    label: 'Started',
    sortable: true,
    render: (row) => <TimeAgo date={row.created_at} />,
  },
  {
    key: 'updated_at',
    label: 'Updated',
    render: (row) => <TimeAgo date={row.updated_at} />,
  },
];

export function McpQueryPage() {
  const navigate = useNavigate();
  const [promptText, setPromptText] = useState('');
  const submitMutation = useSubmitMcpQuery();

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

    const result = await submitMutation.mutateAsync({ prompt });
    setPromptText('');
    navigate(`/mcp/queries/${result.workflow_id}?prompt=${encodeURIComponent(prompt)}`);
  };

  const jobs = data?.jobs ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <PageHeader title="Deterministic MCP" />

      {/* Submit form */}
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-3">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Describe what you want to accomplish..."
            className="flex-1 min-h-[80px] max-h-[200px] px-4 py-3 bg-surface-sunken border border-border rounded-lg text-sm text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:ring-1 focus:ring-accent-primary"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSubmit(e);
              }
            }}
          />
          <button
            type="submit"
            disabled={!promptText.trim() || submitMutation.isPending}
            className="self-end px-6 py-3 bg-accent-primary text-white text-sm font-medium rounded-lg hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitMutation.isPending ? 'Starting...' : 'Run'}
          </button>
        </div>
        {submitMutation.isError && (
          <p className="mt-2 text-sm text-status-error">{submitMutation.error.message}</p>
        )}
        <p className="mt-1 text-xs text-text-tertiary">Press Cmd+Enter to submit</p>
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
