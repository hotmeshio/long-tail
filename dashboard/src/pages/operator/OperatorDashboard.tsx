import { useNavigate } from 'react-router-dom';
import { LockOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useEscalations, useEscalationTypes, useReleaseEscalation } from '../../api/escalations';
import { useEscalationListEvents } from '../../hooks/useEventHooks';
import { useRoles } from '../../api/roles';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { buildApiPath } from '../../lib/api-path';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { RowAction, RowActionGroup } from '../../components/common/layout/RowActions';
import { ESCALATION_COLUMNS, TIME_LEFT_COLUMN, EscalationFilterBar } from './escalation-columns';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import type { LTEscalationRecord } from '../../api/types';

export function OperatorDashboard() {
  useEscalationListEvents();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { role: '', type: '', priority: '', search: '' },
  });
  // Debounce so server-side search fires once the user pauses, not per keystroke.
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const release = useReleaseEscalation();
  const { data: rolesData } = useRoles();
  const { data: typesData } = useEscalationTypes();

  const escalationQuery = {
    assigned_to: user?.userId,
    status: 'pending',
    role: filters.role || undefined,
    type: filters.type || undefined,
    priority: filters.priority ? parseInt(filters.priority) : undefined,
    search: debouncedSearch || undefined,
    sort_by: sort.sort_by || 'created_at',
    order: sort.order || 'desc',
  };

  const { data, isLoading, error: queryError, refetch, isFetching } = useEscalations({
    ...escalationQuery,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  // Search is server-side (full result set) — results and total come straight
  // from the query, no client-side filtering of the current page.
  const activeClaims = data?.escalations ?? [];
  const total = data?.total ?? 0;

  // Copy-URL/curl path built from the SAME params the query sends.
  const apiPath = buildApiPath('/escalations', {
    ...escalationQuery,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  const releaseColumn: Column<LTEscalationRecord> = {
    key: 'actions',
    label: '',
    render: (row) => (
      <RowActionGroup>
        <RowAction
          icon={LockOpen}
          title="Release escalation"
          onClick={() => release.mutate(row.id)}
          colorClass="text-text-tertiary hover:text-status-warning"
        />
      </RowActionGroup>
    ),
    className: 'w-16 text-right',
  };

  // Time-left first (aligns with checkbox on All Escalations), then summary + base columns + actions
  const columns: Column<LTEscalationRecord>[] = [
    TIME_LEFT_COLUMN,
    ...ESCALATION_COLUMNS,
    releaseColumn,
  ];

  return (
    <div>
      <PageHeader title="My Escalations" />

      <EscalationFilterBar
        filters={filters}
        setFilter={setFilter}
        roles={rolesData?.roles ?? []}
        types={typesData?.types ?? []}
        actions={
          <ListToolbar
            onRefresh={() => refetch()}
            isFetching={isFetching}
            apiPath={apiPath}
          />
        }
      />

      {queryError && (
        <div className="mb-4 px-4 py-3 rounded-md bg-status-error/10 border border-status-error/20 text-xs text-status-error">
          {(queryError as Error).message === 'Session expired'
            ? 'Your session has expired. Please log in again.'
            : `Failed to load escalations: ${(queryError as Error).message}`}
        </div>
      )}

      <DataTable
        columns={columns}
        data={activeClaims}
        keyFn={(row) => row.id}
        onRowClick={(row) => navigate(`/escalations/detail/${row.id}`, { state: { from: '/escalations/queue' } })}
        isLoading={isLoading}
        emptyMessage={queryError ? 'Unable to load data' : 'No assigned escalations'}
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
