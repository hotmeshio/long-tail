import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useEscalations, useEscalationTypes } from '../../api/escalations';
import { useEscalationListEvents } from '../../hooks/useNatsEvents';
import { useRoles } from '../../api/roles';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable } from '../../components/common/DataTable';
import { PageHeader } from '../../components/common/PageHeader';
import { StickyPagination } from '../../components/common/StickyPagination';
import { FilterBar, FilterSelect } from '../../components/common/FilterBar';
import { ESCALATION_COLUMNS, TIME_LEFT_COLUMN, PRIORITY_OPTIONS } from './escalation-columns';

export function OperatorDashboard() {
  useEscalationListEvents();
  const navigate = useNavigate();
  const { user, userRoleNames } = useAuth();
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { role: '', type: '', priority: '' },
  });
  const { data: rolesData } = useRoles();
  const { data: typesData } = useEscalationTypes();

  const { data, isLoading } = useEscalations({
    assigned_to: user?.userId,
    status: 'pending',
    role: filters.role || undefined,
    type: filters.type || undefined,
    priority: filters.priority ? parseInt(filters.priority) : undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });

  // Exclude expired claims — they're back in the available pool
  const activeClaims = (data?.escalations ?? []).filter(
    (e) => e.assigned_until && new Date(e.assigned_until) > new Date(),
  );
  const total = data?.total ?? 0;

  // Base columns + time-left before the created_at column
  const columns = [
    ...ESCALATION_COLUMNS.slice(0, -1),
    TIME_LEFT_COLUMN,
    ESCALATION_COLUMNS[ESCALATION_COLUMNS.length - 1],
  ];

  return (
    <div>
      <PageHeader title="My Escalations" />
      <p className="text-sm text-text-tertiary -mt-6 mb-6">
        Roles: {userRoleNames.length > 0 ? userRoleNames.join(', ') : 'none'}
      </p>

      <FilterBar>
        <FilterSelect
          label="Role"
          value={filters.role}
          onChange={(v) => setFilter('role', v)}
          options={(rolesData?.roles ?? []).map((r) => ({ value: r, label: r }))}
        />
        <FilterSelect
          label="Type"
          value={filters.type}
          onChange={(v) => setFilter('type', v)}
          options={(typesData?.types ?? []).map((t) => ({ value: t, label: t }))}
        />
        <FilterSelect
          label="Priority"
          value={filters.priority}
          onChange={(v) => setFilter('priority', v)}
          options={PRIORITY_OPTIONS}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={activeClaims}
        keyFn={(row) => row.id}
        onRowClick={(row) => navigate(`/escalations/detail/${row.id}`, { state: { from: '/escalations/queue' } })}
        isLoading={isLoading}
        emptyMessage="No active escalations"
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
