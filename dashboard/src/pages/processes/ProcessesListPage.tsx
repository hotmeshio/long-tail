import { useNavigate } from 'react-router-dom';
import { useProcesses, type ProcessSummary } from '../../api/tasks';
import { useWorkflowConfigs } from '../../api/workflows';
import { useProcessListEvents } from '../../hooks/useNatsEvents';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { DataTable, type Column } from '../../components/common/DataTable';
import { TimeAgo } from '../../components/common/TimeAgo';
import { StickyPagination } from '../../components/common/StickyPagination';
import { FilterBar, FilterSelect, FilterInput } from '../../components/common/FilterBar';
import { PageHeader } from '../../components/common/PageHeader';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'escalated', label: 'Escalated' },
];

const columns: Column<ProcessSummary>[] = [
  {
    key: 'origin_id',
    label: 'Origin',
    render: (row) => (
      <span className="font-mono text-xs" title={row.origin_id}>
        {row.origin_id.length > 40 ? `${row.origin_id.slice(0, 40)}…` : row.origin_id}
      </span>
    ),
  },
  {
    key: 'workflow_types',
    label: 'Workflows',
    render: (row) => (
      <div className="flex flex-wrap gap-1">
        {row.workflow_types.map((wt) => (
          <span
            key={wt}
            className="px-2 py-0.5 text-[10px] font-mono bg-surface-sunken rounded text-text-secondary"
          >
            {wt}
          </span>
        ))}
      </div>
    ),
  },
  {
    key: 'task_count',
    label: 'Tasks',
    render: (row) => <span>{row.task_count}</span>,
    className: 'w-20 text-right',
  },
  {
    key: 'completed',
    label: 'Completed',
    render: (row) =>
      row.completed > 0
        ? <span className="text-status-success">{row.completed}</span>
        : <span className="text-text-tertiary">0</span>,
    className: 'w-24 text-right',
  },
  {
    key: 'escalated',
    label: 'Escalated',
    render: (row) =>
      row.escalated > 0
        ? <span className="text-status-error">{row.escalated}</span>
        : <span className="text-text-tertiary">0</span>,
    className: 'w-24 text-right',
  },
  {
    key: 'started_at',
    label: 'Started',
    render: (row) => <TimeAgo date={row.started_at} />,
    className: 'w-32',
  },
  {
    key: 'last_activity',
    label: 'Last Activity',
    render: (row) => <TimeAgo date={row.last_activity} />,
    className: 'w-32',
  },
];

export function ProcessesListPage() {
  useProcessListEvents();
  const navigate = useNavigate();
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { workflow_type: '', status: '', search: '' },
  });

  const debouncedSearch = useDebouncedValue(filters.search, 300);

  const { data: configs } = useWorkflowConfigs();
  const workflowTypes = [...new Set((configs ?? []).map((c) => c.workflow_type))].sort();

  const { data, isLoading } = useProcesses({
    workflow_type: filters.workflow_type || undefined,
    status: filters.status || undefined,
    search: debouncedSearch || undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  const total = data?.total ?? 0;

  return (
    <div>
      <PageHeader title="Business Processes" />

      <FilterBar>
        <FilterInput
          label="Search"
          value={filters.search}
          onChange={(v) => setFilter('search', v)}
          placeholder="origin, workflow, or trace ID"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={STATUS_OPTIONS}
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
        data={data?.processes ?? []}
        keyFn={(row) => row.origin_id}
        onRowClick={(row) => navigate(`/processes/detail/${encodeURIComponent(row.origin_id)}`)}
        isLoading={isLoading}
        emptyMessage="No business processes found"
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
