import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMcpRuns, useMcpEntities } from '../../api/mcp-runs';
import { useNamespaces } from '../../api/namespaces';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/DataTable';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PageHeader } from '../../components/common/PageHeader';
import { FilterBar, FilterSelect } from '../../components/common/FilterBar';
import { StickyPagination } from '../../components/common/StickyPagination';
import type { LTJob } from '../../api/types';

const statusMap: Record<string, string> = {
  running: 'in_progress',
  completed: 'completed',
  failed: 'failed',
};

const columns: Column<LTJob>[] = [
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StatusBadge status={statusMap[row.status] ?? row.status} />,
    className: 'w-32',
  },
  {
    key: 'entity',
    label: 'Pipeline',
    render: (row) => (
      <span className="font-mono text-xs text-text-secondary">{row.entity}</span>
    ),
  },
  {
    key: 'workflow_id',
    label: 'Run ID',
    render: (row) => (
      <span className="font-mono text-xs text-text-secondary truncate max-w-[280px] block">
        {row.workflow_id}
      </span>
    ),
  },
  {
    key: 'created_at',
    label: 'Started',
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
];

export function McpRunsPage() {
  const navigate = useNavigate();
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { search: '', entity: '', status: '', namespace: 'longtail' },
  });

  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    if (searchInput === filters.search) return;
    const timer = setTimeout(() => setFilter('search', searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter, filters.search]);

  const activeNamespace = filters.namespace || 'longtail';

  const { data: nsData } = useNamespaces();
  const { data: entitiesData } = useMcpEntities(activeNamespace);

  const { data: runsData, isLoading } = useMcpRuns({
    app_id: activeNamespace,
    limit: pagination.pageSize,
    offset: pagination.offset,
    entity: filters.entity || undefined,
    search: filters.search || undefined,
    status: filters.status || undefined,
  });

  const total = runsData?.total ?? 0;

  const jobs = useMemo(() => {
    const raw = runsData?.jobs ?? [];
    const STATUS_ORDER: Record<string, number> = { running: 0, failed: 1, completed: 2 };
    return [...raw].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 9;
      const sb = STATUS_ORDER[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [runsData?.jobs]);

  const namespaces = useMemo(
    () => (nsData?.namespaces ?? []).map((ns) => ({ value: ns.name, label: ns.name })),
    [nsData?.namespaces],
  );

  const entities = useMemo(
    () => (entitiesData?.entities ?? []).map((e) => ({ value: e, label: e })),
    [entitiesData?.entities],
  );

  return (
    <div>
      <PageHeader title="Pipeline Runs" />

      <FilterBar>
        {namespaces.length > 1 && (
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-text-tertiary">Namespace</label>
            <select
              value={activeNamespace}
              onChange={(e) => {
                setFilter('namespace', e.target.value);
                setFilter('entity', '');
              }}
              className="select text-[11px] py-1 px-2"
            >
              {namespaces.map((ns) => (
                <option key={ns.value} value={ns.value}>{ns.label}</option>
              ))}
            </select>
          </div>
        )}
        <input
          type="text"
          placeholder="Search run ID..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="input text-[11px] py-1 px-2 w-56"
        />
        <FilterSelect
          label="Pipeline"
          value={filters.entity}
          onChange={(v) => setFilter('entity', v)}
          options={entities}
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
        onRowClick={(row) => navigate(`/mcp/runs/${encodeURIComponent(row.workflow_id)}?namespace=${activeNamespace}`)}
        isLoading={isLoading}
        emptyMessage="No pipeline runs found"
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
