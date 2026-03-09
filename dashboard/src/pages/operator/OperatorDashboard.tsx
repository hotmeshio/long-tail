import { useNavigate } from 'react-router-dom';
import { LockOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { useEscalations, useEscalationTypes, useReleaseEscalation } from '../../api/escalations';
import { useEscalationListEvents } from '../../hooks/useNatsEvents';
import { useRoles } from '../../api/roles';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/DataTable';
import { PageHeader } from '../../components/common/PageHeader';
import { StickyPagination } from '../../components/common/StickyPagination';
import { RowAction, RowActionGroup } from '../../components/common/RowActions';
import { ESCALATION_COLUMNS, TIME_LEFT_COLUMN, EscalationFilterBar } from './escalation-columns';
import type { LTEscalationRecord } from '../../api/types';

export function OperatorDashboard() {
  useEscalationListEvents();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { role: '', type: '', priority: '' },
  });
  const { addToast } = useToast();
  const release = useReleaseEscalation();
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
    sort_by: sort.sort_by || undefined,
    order: sort.sort_by ? sort.order : undefined,
  });

  // Exclude expired claims — they're back in the available pool
  const activeClaims = (data?.escalations ?? []).filter(
    (e) => e.assigned_until && new Date(e.assigned_until) > new Date(),
  );
  const total = data?.total ?? 0;

  const releaseColumn: Column<LTEscalationRecord> = {
    key: 'actions',
    label: '',
    render: (row) => (
      <RowActionGroup>
        <RowAction
          icon={LockOpen}
          title="Release escalation"
          onClick={() =>
            release.mutate(row.id, {
              onSuccess: () => addToast('Escalation released', 'success'),
              onError: (err) => addToast((err as Error).message, 'error'),
            })
          }
          colorClass="text-text-tertiary hover:text-status-warning"
        />
      </RowActionGroup>
    ),
    className: 'w-16 text-right',
  };

  // Base columns + time-left before the created_at column + actions
  const columns: Column<LTEscalationRecord>[] = [
    ...ESCALATION_COLUMNS.slice(0, -1),
    TIME_LEFT_COLUMN,
    ESCALATION_COLUMNS[ESCALATION_COLUMNS.length - 1],
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
      />

      <DataTable
        columns={columns}
        data={activeClaims}
        keyFn={(row) => row.id}
        onRowClick={(row) => navigate(`/escalations/detail/${row.id}`, { state: { from: '/escalations/queue' } })}
        isLoading={isLoading}
        emptyMessage="No assigned escalations"
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
