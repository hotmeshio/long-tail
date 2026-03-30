import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMcpRuns, useMcpEntities } from '../../api/mcp-runs';
import { useYamlWorkflowAppIds } from '../../api/yaml-workflows';
import { useNamespaces } from '../../api/namespaces';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { StatusBadge } from '../../components/common/display/StatusBadge';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
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
    label: 'Tool',
    render: (row) => (
      <span className="font-mono text-xs text-text-secondary">{row.entity || '—'}</span>
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
  const { filters, setFilter, setFilters, pagination } = useFilterParams({
    filters: { search: '', entity: '', status: '', namespace: '' },
  });

  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    if (searchInput === filters.search) return;
    const timer = setTimeout(() => setFilter('search', searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter, filters.search]);

  const { data: appIdData } = useYamlWorkflowAppIds();
  const { data: nsData } = useNamespaces();

  // Build the full namespace list: YAML app_ids + registered namespaces
  const allNamespaceNames = useMemo(() => {
    const set = new Set(appIdData?.app_ids ?? []);
    for (const ns of nsData?.namespaces ?? []) {
      set.add(ns.name);
    }
    return [...set].sort();
  }, [appIdData?.app_ids, nsData?.namespaces]);

  // Default: URL param > 'longtail' (if exists) > first in list
  const defaultNamespace = allNamespaceNames.includes('longtail')
    ? 'longtail'
    : allNamespaceNames[0] ?? '';
  const activeNamespace = filters.namespace || defaultNamespace;
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

  const namespaces = useMemo(() => {
    const set = new Set(allNamespaceNames);
    // Always include the active namespace so deep-linked values appear
    if (activeNamespace) set.add(activeNamespace);
    return [...set].sort().map((id) => ({ value: id, label: id }));
  }, [allNamespaceNames, activeNamespace]);

  const entities = useMemo(() => {
    const known = new Set(entitiesData?.entities ?? []);
    if (filters.entity && !known.has(filters.entity)) known.add(filters.entity);
    return [...known].sort().map((e) => ({ value: e, label: e }));
  }, [entitiesData?.entities, filters.entity]);

  return (
    <div>
      <PageHeader title="Pipeline Runs" />

      <FilterBar>
        <FilterSelect
          label="Namespace"
          value={activeNamespace}
          onChange={(v) => {
            setFilters({ namespace: v, entity: '' });
          }}
          options={namespaces}
          required
        />
        <input
          type="text"
          placeholder="Search run ID..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="input text-[11px] py-1 px-2 w-56"
        />
        <FilterSelect
          label="Tool"
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
        onRowClick={(row) => navigate(`/mcp/executions/${encodeURIComponent(row.workflow_id)}?namespace=${activeNamespace}`)}
        isLoading={isLoading}
        emptyMessage="No runs found"
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
