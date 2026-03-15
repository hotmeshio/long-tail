import { useNavigate } from 'react-router-dom';
import { useTasks } from '../../api/tasks';
import { useWorkflowConfigs } from '../../api/workflows';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { StatusBadge } from '../../components/common/display/StatusBadge';
import { PriorityBadge } from '../../components/common/display/PriorityBadge';
import { TimeAgo } from '../../components/common/display/TimeAgo';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { PageHeader } from '../../components/common/layout/PageHeader';
import type { LTTaskRecord } from '../../api/types';

const statusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'needs_intervention', label: 'Needs Intervention' },
  { value: 'cancelled', label: 'Cancelled' },
];

const columns: Column<LTTaskRecord>[] = [
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StatusBadge status={row.status} />,
    className: 'w-40',
  },
  {
    key: 'workflow_type',
    label: 'Workflow Type',
    render: (row) => (
      <span className="font-mono text-xs">{row.workflow_type}</span>
    ),
  },
  {
    key: 'lt_type',
    label: 'LT Type',
    render: (row) => (
      <span className="text-text-secondary text-xs">{row.lt_type}</span>
    ),
  },
  {
    key: 'priority',
    label: 'Priority',
    render: (row) => <PriorityBadge priority={row.priority} />,
    className: 'w-20',
  },
  {
    key: 'started_at',
    label: 'Started',
    render: (row) => <TimeAgo date={row.started_at} />,
    className: 'w-28',
  },
  {
    key: 'updated_at',
    label: 'Updated',
    render: (row) => <TimeAgo date={row.updated_at} />,
    className: 'w-28',
  },
];

export function TasksListPage() {
  const navigate = useNavigate();
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { status: '', workflow_type: '' },
  });

  const { data: configs } = useWorkflowConfigs();
  const workflowTypes = [...new Set((configs ?? []).map((c) => c.workflow_type))].sort();

  const { data, isLoading } = useTasks({
    status: filters.status || undefined,
    workflow_type: filters.workflow_type || undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  const total = data?.total ?? 0;

  return (
    <div>
      <PageHeader title="Tasks" />

      <FilterBar>
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={statusOptions}
        />
        <FilterSelect
          label="Workflow Type"
          value={filters.workflow_type}
          onChange={(v) => setFilter('workflow_type', v)}
          options={workflowTypes.map((t) => ({ value: t, label: t }))}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={data?.tasks ?? []}
        keyFn={(row) => row.id}
        onRowClick={(row) => navigate(`/workflows/tasks/detail/${row.id}`)}
        isLoading={isLoading}
        emptyMessage="No tasks found"
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
