import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import {
  useAvailableEscalations,
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
import { PriorityBadge } from '../../components/common/PriorityBadge';
import { TimeAgo } from '../../components/common/TimeAgo';
import { StickyPagination } from '../../components/common/StickyPagination';
import { FilterBar, FilterSelect } from '../../components/common/FilterBar';
import { Modal } from '../../components/common/Modal';
import { PageHeader } from '../../components/common/PageHeader';
import { BulkActionBar } from '../../components/common/BulkActionBar';
import { BulkAssignModal } from '../../components/common/BulkAssignModal';
import { BulkTriageModal } from '../../components/common/BulkTriageModal';
import { CLAIM_DURATION_OPTIONS } from '../../lib/constants';
import type { LTEscalationRecord } from '../../api/types';

export function AvailableEscalationsPage() {
  const navigate = useNavigate();
  const { user, isSuperAdmin } = useAuth();
  const { addToast } = useToast();
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { role: '', type: '', priority: '' },
  });
  const [claimTarget, setClaimTarget] = useState<LTEscalationRecord | null>(null);
  const [claimDuration, setClaimDuration] = useState('30');
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
  }, [filters.role, filters.type, filters.priority, pagination.page, pagination.pageSize]);

  const { data, isLoading } = useAvailableEscalations({
    role: filters.role || undefined,
    type: filters.type || undefined,
    priority: filters.priority ? parseInt(filters.priority) : undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
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

  // ── Single-item claim ──────────────────────────────────────────────────────
  const handleClaim = () => {
    if (!claimTarget) return;
    claim.mutate(
      { id: claimTarget.id, durationMinutes: parseInt(claimDuration) },
      {
        onSuccess: () => {
          setClaimTarget(null);
          navigate(`/escalations/${claimTarget.id}`);
        },
      },
    );
  };

  // ── Bulk action handlers ───────────────────────────────────────────────────
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

  // ── Selection helpers ──────────────────────────────────────────────────────
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

  // ── Table columns ──────────────────────────────────────────────────────────
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
    {
      key: 'type',
      label: 'Type',
      render: (row) => (
        <div>
          <p className="text-sm text-text-primary">{row.type}</p>
          {row.subtype && (
            <p className="text-xs text-text-tertiary">{row.subtype}</p>
          )}
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (row) => (
        <span className="px-2 py-0.5 text-[10px] bg-surface-sunken rounded-full text-text-secondary">
          {row.role}
        </span>
      ),
      className: 'w-32',
    },
    {
      key: 'priority',
      label: 'Priority',
      render: (row) => <PriorityBadge priority={row.priority} />,
      className: 'w-20',
    },
    {
      key: 'workflow_type',
      label: 'Workflow',
      render: (row) => (
        <span className="text-xs font-mono text-text-secondary">{row.workflow_type}</span>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (row) => <TimeAgo date={row.created_at} />,
      className: 'w-28',
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setClaimTarget(row);
          }}
          className="btn-primary text-xs"
        >
          Claim
        </button>
      ),
      className: 'w-24',
    },
  );

  return (
    <div>
      <PageHeader title="Available Escalations" />

      <div className="mb-6">
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
            options={[
              { value: '1', label: 'P1' },
              { value: '2', label: 'P2' },
              { value: '3', label: 'P3' },
              { value: '4', label: 'P4' },
            ]}
          />
        </FilterBar>
      </div>

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
        onRowClick={(row) => navigate(`/escalations/${row.id}`, { state: { from: '/escalations' } })}
        isLoading={isLoading}
        emptyMessage="No available escalations"
      />

      <StickyPagination
        page={pagination.page}
        totalPages={pagination.totalPages(total)}
        onPageChange={pagination.setPage}
        total={total}
        pageSize={pagination.pageSize}
        onPageSizeChange={pagination.setPageSize}
      />

      {/* Single-item claim dialog */}
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
            onChange={(e) => setClaimDuration(e.target.value)}
            className="select w-full text-sm"
          >
            {CLAIM_DURATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
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

      {/* Bulk triage dialog */}
      <BulkTriageModal
        open={triageModalOpen}
        onClose={() => setTriageModalOpen(false)}
        selectedCount={selectedIds.size}
        onSubmit={handleBulkTriage}
        isPending={bulkTriage.isPending}
      />

      {/* Bulk assign dialog */}
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
