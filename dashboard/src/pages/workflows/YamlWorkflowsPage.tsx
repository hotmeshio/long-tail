import { useNavigate } from 'react-router-dom';
import { useYamlWorkflows } from '../../api/yaml-workflows';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/DataTable';
import { StatusBadge } from '../../components/common/StatusBadge';
import { TimeAgo } from '../../components/common/TimeAgo';
import { PageHeader } from '../../components/common/PageHeader';
import { FilterBar, FilterSelect } from '../../components/common/FilterBar';
import { StickyPagination } from '../../components/common/StickyPagination';
import type { LTYamlWorkflowRecord } from '../../api/types';

const statusMap: Record<string, string> = {
  draft: 'pending',
  deployed: 'in_progress',
  active: 'completed',
  archived: 'failed',
};

const columns: Column<LTYamlWorkflowRecord>[] = [
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StatusBadge status={statusMap[row.status] ?? row.status} />,
    className: 'w-28',
  },
  {
    key: 'name',
    label: 'Name',
    render: (row) => (
      <div>
        <span className="font-mono text-xs font-medium">{row.name}</span>
        {row.description && (
          <p className="text-[10px] text-text-tertiary truncate max-w-[300px]">
            {row.description}
          </p>
        )}
      </div>
    ),
  },
  {
    key: 'source_workflow_type',
    label: 'Source Type',
    render: (row) => (
      <span className="font-mono text-xs text-text-secondary">
        {row.source_workflow_type ?? '—'}
      </span>
    ),
  },
  {
    key: 'activities',
    label: 'Activities',
    render: (row) => (
      <span className="text-xs text-text-secondary">
        {row.activity_manifest.filter((a) => a.type === 'worker').length}
      </span>
    ),
    className: 'w-24',
  },
  {
    key: 'created_at',
    label: 'Created',
    render: (row) => <TimeAgo date={row.created_at} />,
    className: 'w-32',
  },
];

export function YamlWorkflowsPage() {
  const navigate = useNavigate();
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { status: '' },
  });

  const { data, isLoading } = useYamlWorkflows({
    status: (filters.status || undefined) as any,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  const workflows = data?.workflows ?? [];
  const total = data?.total ?? 0;

  return (
    <div>
      <PageHeader title="YAML Workflows" />

      <FilterBar>
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={[
            { value: 'draft', label: 'Draft' },
            { value: 'deployed', label: 'Deployed' },
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={workflows}
        keyFn={(row) => row.id}
        onRowClick={(row) => navigate(`/workflows/yaml/${row.id}`)}
        isLoading={isLoading}
        emptyMessage="No YAML workflows found"
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
