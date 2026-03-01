import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJobs, useWorkflowConfigs } from '../../api/workflows';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/DataTable';
import { StatusBadge } from '../../components/common/StatusBadge';
import { TimeAgo } from '../../components/common/TimeAgo';
import { PageHeader } from '../../components/common/PageHeader';
import { FilterBar, FilterSelect } from '../../components/common/FilterBar';
import { StickyPagination } from '../../components/common/StickyPagination';
import type { LTJob } from '../../api/types';

const jobStatusMap: Record<string, string> = {
  running: 'in_progress',
  completed: 'completed',
  failed: 'needs_intervention',
};

const columns: Column<LTJob>[] = [
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StatusBadge status={jobStatusMap[row.status] ?? row.status} />,
    className: 'w-40',
  },
  {
    key: 'entity',
    label: 'Workflow Type',
    render: (row) => <span className="font-mono text-xs">{row.entity}</span>,
  },
  {
    key: 'workflow_id',
    label: 'Workflow ID',
    render: (row) => (
      <span className="font-mono text-xs text-text-secondary truncate max-w-[240px] block">
        {row.workflow_id}
      </span>
    ),
  },
  {
    key: 'created_at',
    label: 'Created',
    render: (row) => <TimeAgo date={row.created_at} />,
    className: 'w-32',
  },
];

export function WorkflowsDashboard() {
  const navigate = useNavigate();
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { search: '', entity: '' },
  });
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    const timer = setTimeout(() => setFilter('search', searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter]);

  const { data: jobsData, isLoading } = useJobs({
    limit: pagination.pageSize,
    offset: pagination.offset,
    entity: filters.entity || undefined,
    search: filters.search || undefined,
  });
  const { data: configs } = useWorkflowConfigs();

  const jobs = jobsData?.jobs ?? [];
  const total = jobsData?.total ?? 0;

  const entities = [...new Set((configs ?? []).map((c) => c.workflow_type))].sort();

  return (
    <div>
      <PageHeader title="Workflows" />

      <div className="flex items-center justify-between mb-4">
        <FilterBar>
          <input
            type="text"
            placeholder="Search workflow ID..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="input text-xs w-64"
          />
          <FilterSelect
            label="Type"
            value={filters.entity}
            onChange={(v) => setFilter('entity', v)}
            options={entities.map((e) => ({ value: e, label: e }))}
          />
        </FilterBar>
      </div>

      <DataTable
        columns={columns}
        data={jobs}
        keyFn={(row) => row.workflow_id}
        onRowClick={(row) => navigate(`/workflows/execution/${row.workflow_id}`)}
        isLoading={isLoading}
        emptyMessage="No workflow jobs found"
      />

      <StickyPagination
        page={pagination.page}
        totalPages={pagination.totalPages(total)}
        onPageChange={pagination.setPage}
        total={total}
        pageSize={pagination.pageSize}
        onPageSizeChange={pagination.setPageSize}
      />
    </div>
  );
}
