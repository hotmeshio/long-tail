import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Filter, Settings } from 'lucide-react';
import { useJobs, useWorkflowConfigs } from '../../api/workflows';
import { useAuth } from '../../hooks/useAuth';
import { useWorkflowListEvents } from '../../hooks/useNatsEvents';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { RowAction, RowActionGroup } from '../../components/common/layout/RowActions';
import type { LTJob } from '../../api/types';

export type ExecutionsTier = 'all' | 'certified' | 'durable';

const jobStatusMap: Record<string, string> = {
  running: 'in_progress',
  completed: 'completed',
  failed: 'failed',
};

const STATUS_DOT: Record<string, string> = {
  in_progress: 'bg-status-active',
  completed: 'bg-status-success',
  failed: 'bg-status-error',
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
  certifiedTypes: Set<string>,
): Column<LTJob>[] {
  return [
    {
      key: 'workflow_id',
      label: 'Workflow ID',
      render: (row) => {
        const dotClass = STATUS_DOT[jobStatusMap[row.status] ?? row.status] ?? 'bg-status-pending';
        const pulseClass = row.status === 'running' ? ' animate-pulse' : '';
        return (
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className={`w-2 h-2 shrink-0 rounded-full ${dotClass}${pulseClass}`} title={row.status} />
            <span className="font-mono text-xs text-text-secondary truncate">
              {row.workflow_id}
            </span>
          </span>
        );
      },
    },
    {
      key: 'entity',
      label: 'Workflow Type',
      render: (row) => <WorkflowPill type={row.entity} certified={certifiedTypes.has(row.entity)} />,
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
              onClick={() => navigate(`/workflows/registry/${encodeURIComponent(row.entity)}`)}
            />
          )}
        </RowActionGroup>
      ),
      className: 'w-24 text-right',
    },
  ];
}

export function WorkflowsDashboard({ tier: initialTier = 'all' }: { tier?: ExecutionsTier }) {
  useWorkflowListEvents();
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();

  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { search: '', entity: '', status: '', tier: initialTier },
  });

  const activeTier = (filters.tier || 'all') as ExecutionsTier;

  // Map tier to server-side registered filter
  const registeredFilter = activeTier === 'certified' ? 'true'
    : activeTier === 'durable' ? 'false'
    : undefined;

  const { data: configs } = useWorkflowConfigs();

  const certifiedTypes = useMemo(
    () => new Set((configs ?? []).map((c) => c.workflow_type)),
    [configs],
  );

  const columns = buildColumns(
    (entity) => setFilter('entity', entity),
    (status) => setFilter('status', status),
    isSuperAdmin,
    navigate,
    certifiedTypes,
  );
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
    registered: registeredFilter,
  });

  const total = jobsData?.total ?? 0;
  const jobs = jobsData?.jobs ?? [];

  const entities = useMemo(() => {
    return [...new Set((configs ?? []).map((c) => c.workflow_type))].sort();
  }, [configs]);

  const pageTitle = 'Durable Executions';

  const emptyMessage = activeTier === 'certified'
    ? 'No certified workflow executions found'
    : activeTier === 'durable'
      ? 'No durable workflow executions found'
      : 'No workflow executions found';

  return (
    <div>
      <PageHeader title={pageTitle} />

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
        <FilterSelect
          label="Tier"
          value={filters.tier === 'all' ? '' : filters.tier}
          onChange={(v) => setFilter('tier', v || 'all')}
          options={[
            { value: 'certified', label: 'Certified' },
            { value: 'durable', label: 'Durable' },
          ]}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={jobs}
        keyFn={(row) => row.workflow_id}
        onRowClick={(row) => navigate(`/workflows/executions/${row.workflow_id}`)}
        isLoading={isLoading}
        emptyMessage={emptyMessage}
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
