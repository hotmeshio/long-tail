import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Filter } from 'lucide-react';
import { useMcpRuns, useMcpEntities } from '../../api/pipelines';
import { useYamlWorkflowAppIds } from '../../api/yaml-workflows';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useNamespace } from '../../hooks/useNamespace';
import { buildApiPath } from '../../lib/api-path';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { WorkflowPill } from '../../components/common/display/WorkflowPill';
import { ElapsedCell } from '../../components/common/display/ElapsedCell';
import { DateValue } from '../../components/common/display/DateValue';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { FilterBar, FilterSelect } from '../../components/common/data/FilterBar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { RowAction, RowActionGroup } from '../../components/common/layout/RowActions';
import type { LTJob } from '../../api/types';

const statusMap: Record<string, string> = {
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
): Column<LTJob>[] {
  return [
    {
      key: 'workflow_id',
      label: 'Run ID',
      render: (row) => {
        const dotClass = STATUS_DOT[statusMap[row.status] ?? row.status] ?? 'bg-status-pending';
        const pulseClass = row.status === 'running' ? ' animate-pulse' : '';
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-1.5 h-1.5 shrink-0 rounded-full dot-ring ${dotClass}${pulseClass}`} title={row.status} />
            <span className="font-mono text-xs text-text-primary truncate">{row.workflow_id}</span>
          </div>
        );
      },
    },
    {
      key: 'entity',
      label: 'Tool',
      render: (row) => row.entity
        ? <WorkflowPill type={row.entity} variant="pipeline" size="xs" />
        : <span className="text-[10px] text-text-tertiary">—</span>,
      className: 'w-44 shrink-0',
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      render: (row) => <DateValue date={row.created_at} format="relative" className="text-xs text-text-secondary whitespace-nowrap" />,
      className: 'w-32',
    },
    {
      key: 'updated_at',
      label: 'Updated',
      sortable: true,
      render: (row) => <DateValue date={row.updated_at} format="relative" className="text-xs text-text-secondary whitespace-nowrap" />,
      className: 'w-32',
    },
    {
      key: 'duration',
      label: 'Duration',
      render: (row) => (
        <ElapsedCell
          startDate={row.created_at}
          endDate={row.status === 'running' ? null : row.updated_at}
          isLive={row.status === 'running'}
        />
      ),
      className: 'w-28',
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
            <svg className={`w-[18px] h-[18px] ${STATUS_COLORS[row.status] ?? 'text-text-tertiary'} hover:opacity-70`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="12" cy="12" r="6" />
            </svg>
          </button>
        </RowActionGroup>
      ),
      className: 'w-24 text-right',
    },
  ];
}

export function McpRunsPage() {
  const navigate = useNavigate();
  const { namespace: hookNamespace, available } = useNamespace('namespace');
  const { filters, setFilter, setFilters, pagination, sort, setSort } = useFilterParams({
    filters: { search: '', entity: '', status: '', namespace: '' },
  });

  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    if (searchInput === filters.search) return;
    const timer = setTimeout(() => setFilter('search', searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter, filters.search]);

  const { data: appIdData } = useYamlWorkflowAppIds();

  // Merge real HotMesh namespaces (from controlplane/apps) with YAML workflow app_ids
  const allNamespaceNames = useMemo(() => {
    const set = new Set(available);
    for (const id of appIdData?.app_ids ?? []) {
      set.add(id);
    }
    return [...set].sort();
  }, [available, appIdData?.app_ids]);

  const activeNamespace = filters.namespace || hookNamespace;
  const { data: entitiesData } = useMcpEntities(activeNamespace);

  const { data: runsData, isLoading, refetch, isFetching } = useMcpRuns({
    app_id: activeNamespace,
    limit: pagination.pageSize,
    offset: pagination.offset,
    entity: filters.entity || undefined,
    search: filters.search || undefined,
    status: filters.status || undefined,
    sort_by: sort.sort_by || 'created_at',
    order: sort.order || 'desc',
  });

  const total = runsData?.total ?? 0;
  const jobs = runsData?.jobs ?? [];

  const columns = buildColumns(
    (entity) => setFilter('entity', entity),
    (status) => setFilter('status', status),
  );

  const namespaces = useMemo(() => {
    const set = new Set(allNamespaceNames);
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
      <PageHeader title="Pipeline Executions" docsHash="#docs:dashboard.md:graph-executions" />

      <FilterBar actions={
        <ListToolbar
          onRefresh={() => refetch()}
          isFetching={isFetching}
          apiPath={buildApiPath('/pipelines', {
            app_id: activeNamespace,
            limit: pagination.pageSize,
            offset: pagination.offset,
            entity: filters.entity || undefined,
            status: filters.status || undefined,
            search: filters.search || undefined,
            sort_by: sort.sort_by || 'created_at',
            order: sort.order || 'desc',
          })}
        />
      }>
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
        emptyMessage="No pipeline executions found"
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
