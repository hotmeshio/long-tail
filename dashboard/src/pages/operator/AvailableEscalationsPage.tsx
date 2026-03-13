import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useEscalationListEvents } from '../../hooks/useNatsEvents';
import { useToast } from '../../hooks/useToast';
import {
  useEscalations,
  useEscalationTypes,
  useClaimEscalation,
  useSetEscalationPriority,
  useBulkClaimEscalations,
  useBulkAssignEscalations,
  useBulkEscalateToRole,
  useBulkTriageEscalations,
} from '../../api/escalations';
import { useRoles } from '../../api/roles';
import { useFilterParams } from '../../hooks/useFilterParams';
import { DataTable, type Column } from '../../components/common/DataTable';
import { StickyPagination } from '../../components/common/StickyPagination';
import { Modal } from '../../components/common/Modal';
import { PageHeader } from '../../components/common/PageHeader';
import { BulkActionBar } from '../../components/common/BulkActionBar';
import { BulkAssignModal } from '../../components/common/BulkAssignModal';
import { BulkTriageModal } from '../../components/common/BulkTriageModal';
import { CustomDurationPicker } from '../../components/common/CustomDurationPicker';
import { useClaimDurations } from '../../hooks/useClaimDurations';
import { Lock } from 'lucide-react';
import { ESCALATION_COLUMNS, STATUS_COLUMN, EscalationFilterBar } from './escalation-columns';
import { RowAction, RowActionGroup } from '../../components/common/RowActions';
import type { LTEscalationRecord } from '../../api/types';

export function AvailableEscalationsPage() {
  useEscalationListEvents();
  const navigate = useNavigate();
  const { user, isSuperAdmin } = useAuth();
  const { addToast } = useToast();
  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { role: '', type: '', priority: '', status: 'pending' },
  });
  const claimDurations = useClaimDurations();
  const [claimTarget, setClaimTarget] = useState<LTEscalationRecord | null>(null);
  const [claimDuration, setClaimDuration] = useState('30');
  const [customClaimMinutes, setCustomClaimMinutes] = useState(0);
  const onCustomClaimChange = useCallback((m: number) => setCustomClaimMinutes(m), []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [triageModalOpen, setTriageModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);

  const claim = useClaimEscalation();
  const setPriority = useSetEscalationPriority();
  const bulkClaim = useBulkClaimEscalations();
  const bulkAssign = useBulkAssignEscalations();
  const bulkEscalate = useBulkEscalateToRole();
  const bulkTriage = useBulkTriageEscalations();
  const { data: rolesData } = useRoles();
  const { data: typesData } = useEscalationTypes();

  // Clear selections on filter/page changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filters.role, filters.type, filters.priority, filters.status, pagination.page, pagination.pageSize]);

  const { data, isLoading } = useEscalations({
    status: filters.status || undefined,
    role: filters.role || undefined,
    type: filters.type || undefined,
    priority: filters.priority ? parseInt(filters.priority) : undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
    sort_by: sort.sort_by || undefined,
    order: sort.sort_by ? sort.order : undefined,
  });

  const escalations = data?.escalations ?? [];
  const total = data?.total ?? 0;
  const canBulkManage = isSuperAdmin || user?.roles.some((r) => r.type === 'admin');

  const selectedRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const esc of escalations) {
      if (selectedIds.has(esc.id)) roles.add(esc.role);
    }
    return [...roles];
  }, [escalations, selectedIds]);

  const handleClaim = () => {
    if (!claimTarget) return;
    const minutes = claimDuration === 'custom' ? customClaimMinutes : parseInt(claimDuration);
    if (!minutes || minutes <= 0) return;
    claim.mutate(
      { id: claimTarget.id, durationMinutes: minutes },
      {
        onSuccess: () => {
          setClaimTarget(null);
          navigate(`/escalations/detail/${claimTarget.id}`);
        },
      },
    );
  };

  const handleSetPriority = (priority: 1 | 2 | 3 | 4) => {
    setPriority.mutate(
      { ids: [...selectedIds], priority },
      {
        onSuccess: (data) => {
          addToast(`Priority updated for ${data.updated} escalation(s)`, 'success');
          setSelectedIds(new Set());
        },
        onError: (err) => addToast((err as Error).message, 'error'),
      },
    );
  };

  const handleBulkClaim = (durationMinutes: number) => {
    bulkClaim.mutate(
      { ids: [...selectedIds], durationMinutes },
      {
        onSuccess: (data) => {
          const msg = data.skipped
            ? `Claimed ${data.claimed} escalation(s), ${data.skipped} skipped`
            : `Claimed ${data.claimed} escalation(s)`;
          addToast(msg, 'success');
          setSelectedIds(new Set());
        },
        onError: (err) => addToast((err as Error).message, 'error'),
      },
    );
  };

  const handleBulkEscalate = (targetRole: string) => {
    bulkEscalate.mutate(
      { ids: [...selectedIds], targetRole },
      {
        onSuccess: (data) => {
          addToast(`Escalated ${data.updated} escalation(s) to ${targetRole}`, 'success');
          setSelectedIds(new Set());
        },
        onError: (err) => addToast((err as Error).message, 'error'),
      },
    );
  };

  const handleBulkTriage = (hint?: string) => {
    bulkTriage.mutate(
      { ids: [...selectedIds], hint },
      {
        onSuccess: (data) => {
          addToast(`Submitted ${data.triaged} escalation(s) for triage`, 'success');
          setSelectedIds(new Set());
          setTriageModalOpen(false);
        },
        onError: (err) => addToast((err as Error).message, 'error'),
      },
    );
  };

  const handleBulkAssign = (targetUserId: string, durationMinutes: number) => {
    bulkAssign.mutate(
      { ids: [...selectedIds], targetUserId, durationMinutes },
      {
        onSuccess: (data) => {
          const msg = data.skipped
            ? `Assigned ${data.assigned} escalation(s), ${data.skipped} skipped`
            : `Assigned ${data.assigned} escalation(s)`;
          addToast(msg, 'success');
          setSelectedIds(new Set());
          setAssignModalOpen(false);
        },
        onError: (err) => addToast((err as Error).message, 'error'),
      },
    );
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === escalations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(escalations.map((e) => e.id)));
    }
  };

  const columns: Column<LTEscalationRecord>[] = [];

  if (canBulkManage) {
    columns.push({
      key: 'select',
      label: (
        <input
          type="checkbox"
          checked={escalations.length > 0 && selectedIds.size === escalations.length}
          onChange={toggleAll}
          className="rounded"
        />
      ) as any,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={(e) => {
            e.stopPropagation();
            toggleSelect(row.id);
          }}
          onClick={(e) => e.stopPropagation()}
          className="rounded"
        />
      ),
      className: 'w-10',
    });
  }

  columns.push(
    STATUS_COLUMN,
    ...ESCALATION_COLUMNS,
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <RowActionGroup>
          <RowAction
            icon={Lock}
            title="Claim escalation"
            onClick={() => setClaimTarget(row)}
          />
        </RowActionGroup>
      ),
      className: 'w-16 text-right',
    },
  );

  return (
    <div>
      <PageHeader title="All Escalations" />

      <EscalationFilterBar
        filters={filters}
        setFilter={setFilter}
        roles={rolesData?.roles ?? []}
        types={typesData?.types ?? []}
        showStatus
      />

      {selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onClearSelection={() => setSelectedIds(new Set())}
          onSetPriority={handleSetPriority}
          onClaim={handleBulkClaim}
          onAssign={() => setAssignModalOpen(true)}
          onEscalate={handleBulkEscalate}
          onTriage={() => setTriageModalOpen(true)}
          isPriorityPending={setPriority.isPending}
          isClaimPending={bulkClaim.isPending}
          isAssignPending={bulkAssign.isPending}
          isEscalatePending={bulkEscalate.isPending}
          isTriagePending={bulkTriage.isPending}
          availableRoles={rolesData?.roles ?? []}
        />
      )}

      <DataTable
        columns={columns}
        data={escalations}
        keyFn={(row) => row.id}
        onRowClick={(row) => navigate(`/escalations/detail/${row.id}`, { state: { from: '/escalations/available' } })}
        isLoading={isLoading}
        emptyMessage="No available escalations"
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

      <Modal
        open={!!claimTarget}
        onClose={() => setClaimTarget(null)}
        title="Claim Escalation"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Claim <span className="font-medium text-text-primary">{claimTarget?.type}</span> for:
          </p>
          <select
            value={claimDuration}
            onChange={(e) => { setClaimDuration(e.target.value); setCustomClaimMinutes(0); }}
            className="select w-full text-sm"
          >
            {claimDurations.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            <option value="custom">Other...</option>
          </select>
          {claimDuration === 'custom' && (
            <CustomDurationPicker onChange={onCustomClaimChange} autoFocus />
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setClaimTarget(null)} className="btn-secondary text-xs">
              Cancel
            </button>
            <button
              onClick={handleClaim}
              className="btn-primary text-xs"
              disabled={claim.isPending}
            >
              {claim.isPending ? 'Claiming...' : 'Claim'}
            </button>
          </div>
        </div>
      </Modal>

      <BulkTriageModal
        open={triageModalOpen}
        onClose={() => setTriageModalOpen(false)}
        selectedCount={selectedIds.size}
        onSubmit={handleBulkTriage}
        isPending={bulkTriage.isPending}
      />

      <BulkAssignModal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        selectedCount={selectedIds.size}
        selectedRoles={selectedRoles}
        onSubmit={handleBulkAssign}
        isPending={bulkAssign.isPending}
      />
    </div>
  );
}
