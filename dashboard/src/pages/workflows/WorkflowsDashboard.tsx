import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Filter, Settings } from 'lucide-react';
import { useJobs, useWorkflowConfigs } from '../../api/workflows';
import { useAuth } from '../../hooks/useAuth';
import { useWorkflowListEvents } from '../../hooks/useNatsEvents';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/DataTable';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PageHeader } from '../../components/common/PageHeader';
import { FilterBar, FilterSelect } from '../../components/common/FilterBar';
import { StickyPagination } from '../../components/common/StickyPagination';
import { RowAction, RowActionGroup } from '../../components/common/RowActions';
import type { LTJob } from '../../api/types';

const jobStatusMap: Record<string, string> = {
  running: 'in_progress',
  completed: 'completed',
  failed: 'failed',
};

const STATUS_COLORS: Record<string, string> = {
  running: 'text-status-active',
  completed: 'text-status-success',
  failed: 'text-status-error',
};

function buildColumns(
  onFilterEntity: (entity: string) => void,
  onFilterStatus: (status: string) => void,
  isSuperAdmin: boolean,
  navigate: (path: string) => void,
): Column<LTJob>[] {
  return [
    {
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge status={jobStatusMap[row.status] ?? row.status} />,
      className: 'w-40',
    },
    {
      key: 'entity',
      label: 'Workflow Type',
      render: (row) => (
        <span className="font-mono text-xs text-text-secondary">{row.entity}</span>
      ),
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
      render: (row) => (
        <span className="text-xs text-text-secondary font-mono">
          {new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 23)}
        </span>
      ),
      className: 'w-52',
      sortable: true,
    },
    {
      key: 'updated_at',
      label: 'Updated',
      render: (row) => (
        <span className="text-xs text-text-secondary font-mono">
          {new Date(row.updated_at).toISOString().replace('T', ' ').slice(0, 23)}
        </span>
      ),
      className: 'w-52',
      sortable: true,
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <RowActionGroup>
          <RowAction
            icon={Filter}
            title={`Filter by ${row.entity}`}
            onClick={() => onFilterEntity(row.entity)}
          />
          <button
            onClick={(e) => { e.stopPropagation(); onFilterStatus(row.status); }}
            className="opacity-0 group-hover/row:opacity-100 transition-opacity"
            title={`Filter by ${row.status}`}
          >
            <svg className={`w-[18px] h-[18px] ${STATUS_COLORS[row.status] ?? 'text-text-tertiary'} hover:opacity-70`} viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="6" />
            </svg>
          </button>
          {isSuperAdmin && (
            <RowAction
              icon={Settings}
              title="View config"
              onClick={() => navigate(`/workflows/config/${encodeURIComponent(row.entity)}`)}
            />
          )}
        </RowActionGroup>
      ),
      className: 'w-24 text-right',
    },
  ];
}

export function WorkflowsDashboard() {
  useWorkflowListEvents();
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { search: '', entity: '', status: '' },
  });

  const columns = buildColumns((entity) => setFilter('entity', entity), (status) => setFilter('status', status), isSuperAdmin, navigate);
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
    status: filters.status || undefined,
    sort_by: sort.sort_by || undefined,
    order: sort.sort_by ? sort.order : undefined,
  });
  const { data: configs } = useWorkflowConfigs();

  const total = jobsData?.total ?? 0;
  const jobs = jobsData?.jobs ?? [];

  const entities = [...new Set((configs ?? []).map((c) => c.workflow_type))].sort();

  return (
    <div>
      <PageHeader title="Workflow Runs" />

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
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={[
            { value: 'running', label: 'Running' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={jobs}
        keyFn={(row) => row.workflow_id}
        onRowClick={(row) => navigate(`/workflows/detail/${row.workflow_id}`)}
        isLoading={isLoading}
        emptyMessage="No workflow jobs found"
        sort={sort}
        onSort={setSort}
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
