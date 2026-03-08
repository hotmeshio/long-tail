import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJobs, useWorkflowConfigs } from '../../api/workflows';
import { useAuth } from '../../hooks/useAuth';
import { useWorkflowListEvents } from '../../hooks/useNatsEvents';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/DataTable';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PageHeader } from '../../components/common/PageHeader';
import { FilterBar, FilterSelect } from '../../components/common/FilterBar';
import { StickyPagination } from '../../components/common/StickyPagination';
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
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <span className="flex items-center justify-end gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onFilterStatus(row.status); }}
            className="opacity-0 group-hover/row:opacity-100 transition-opacity"
            title={`Filter by ${row.status}`}
          >
            <svg className={`w-3 h-3 ${STATUS_COLORS[row.status] ?? 'text-text-tertiary'} hover:opacity-70`} viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="6" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onFilterEntity(row.entity); }}
            className="opacity-0 group-hover/row:opacity-100 transition-opacity"
            title={`Filter by ${row.entity}`}
          >
            <svg className="w-3 h-3 text-text-tertiary hover:text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>
          {isSuperAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/admin/config/${encodeURIComponent(row.entity)}`); }}
              className="opacity-0 group-hover/row:opacity-100 transition-opacity"
              title="View config"
            >
              <svg className="w-3 h-3 text-text-tertiary hover:text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
        </span>
      ),
      className: 'w-20 text-right',
    },
  ];
}

export function WorkflowsDashboard() {
  useWorkflowListEvents();
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { search: '', entity: '', status: '' },
  });

  const columns = useMemo(
    () => buildColumns((entity) => setFilter('entity', entity), (status) => setFilter('status', status), isSuperAdmin, navigate),
    [setFilter, isSuperAdmin, navigate],
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
  });
  const { data: configs } = useWorkflowConfigs();

  const total = jobsData?.total ?? 0;

  // Sort: running first, then by created_at desc
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
