import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJobs, useWorkflowConfigs } from '../../api/workflows';
import { useWorkflowListEvents } from '../../hooks/useNatsEvents';
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
  useWorkflowListEvents();
  const navigate = useNavigate();
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { search: '', entity: '' },
  });
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    if (searchInput === filters.search) return;
    const timer = setTimeout(() => setFilter('search', searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter, filters.search]);

  const { data: jobsData, isLoading } = useJobs({
    limit: pagination.pageSize,
    offset: pagination.offset,
    entity: filters.entity || undefined,
    search: filters.search || undefined,
  });
  const { data: configs } = useWorkflowConfigs();

  const total = jobsData?.total ?? 0;

  // Sort: running (in_progress) first, then by created_at descending (newest first)
  const STATUS_ORDER: Record<string, number> = { running: 0, failed: 1, completed: 2 };
  const jobs = useMemo(() => {
    const raw = jobsData?.jobs ?? [];
    return [...raw].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 9;
      const sb = STATUS_ORDER[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [jobsData?.jobs]);

  const entities = [...new Set((configs ?? []).map((c) => c.workflow_type))].sort();

  return (
    <div>
      <PageHeader title="Workflows" />

      <FilterBar>
        <input
          type="text"
          placeholder="Search workflow ID..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="input text-[11px] py-1 px-2 w-56"
        />
        <FilterSelect
          label="Type"
          value={filters.entity}
          onChange={(v) => setFilter('entity', v)}
          options={entities.map((e) => ({ value: e, label: e }))}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={jobs}
        keyFn={(row) => row.workflow_id}
        onRowClick={(row) => navigate(`/workflows/detail/${row.workflow_id}`)}
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
