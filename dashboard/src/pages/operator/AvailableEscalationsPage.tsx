import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { parseFacetParams, writeFacetParams, facetCount } from '../../lib/facet-url';
import { useAccess } from '../../hooks/useAccess';
import { useEscalationListEvents } from '../../hooks/useEventHooks';
import {
  useEscalations,
  useAvailableEscalations,
  useEscalationTypes,
  useFacetKeys,
  useClaimEscalation,
  useSetEscalationPriority,
  useBulkClaimEscalations,
  useBulkAssignEscalations,
  useBulkEscalateToRole,
  useBulkTriageEscalations,
  useBulkCancelEscalations,
  type FacetFilters,
} from '../../api/escalations';
import { FacetedFilterPanel } from './FacetedFilterPanel';
import { ConfirmCancelModal } from '../../components/common/modal/ConfirmCancelModal';
import { useRoles } from '../../api/roles';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { buildApiPath } from '../../lib/api-path';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { BulkActionBar } from '../../components/common/modal/BulkActionBar';
import { BulkAssignModal } from '../../components/common/modal/BulkAssignModal';
import { BulkTriageModal } from '../../components/common/modal/BulkTriageModal';
import { useClaimDurations } from '../../hooks/useClaimDurations';
import { Lock, SlidersHorizontal, X } from 'lucide-react';
import { ESCALATION_COLUMNS, EscalationFilterBar } from './escalation-columns';
import { RowAction, RowActionGroup } from '../../components/common/layout/RowActions';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { createBulkHandlers } from './helpers';
import { ClaimModal } from './ClaimModal';
import type { LTEscalationRecord } from '../../api/types';

export function AvailableEscalationsPage() {
  useEscalationListEvents();
  const navigate = useNavigate();
  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { role: '', type: '', priority: '', status: 'available', search: '' },
  });
  // Debounce so server-side search fires once the user pauses, not per keystroke.
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const claimDurations = useClaimDurations();
  const [claimTarget, setClaimTarget] = useState<LTEscalationRecord | null>(null);
  const [claimDuration, setClaimDuration] = useState('30');
  const [customClaimMinutes, setCustomClaimMinutes] = useState(0);
  const onCustomClaimChange = useCallback((m: number) => setCustomClaimMinutes(m), []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Faceted query — DEEP-LINKED in the URL (a shared link reproduces the exact query).
  // The drawer is the editor surface; fetched keys feed the autocomplete.
  const [facetDrawerOpen, setFacetDrawerOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const facetFilters = useMemo<FacetFilters>(() => parseFacetParams(searchParams), [searchParams]);
  const setFacetFilters = useCallback((next: FacetFilters) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      writeFacetParams(p, next);
      p.delete('page');
      return p;
    }, { replace: true });
  }, [setSearchParams]);
  const { data: facetKeysData } = useFacetKeys(facetDrawerOpen);
  // The free-text term now lives in the drawer alongside the facets, so it counts
  // toward the active-query badge and is cleared by the drawer's Clear.
  const activeFacetCount = facetCount(facetFilters) + (filters.search ? 1 : 0);
  const [triageModalOpen, setTriageModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const claim = useClaimEscalation();
  const setPriority = useSetEscalationPriority();
  const bulkClaim = useBulkClaimEscalations();
  const bulkAssign = useBulkAssignEscalations();
  const bulkEscalate = useBulkEscalateToRole();
  const bulkTriage = useBulkTriageEscalations();
  const bulkCancel = useBulkCancelEscalations();
  const { data: rolesData } = useRoles();
  const { data: typesData } = useEscalationTypes();

  // Clear selections on filter/page changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filters.role, filters.type, filters.priority, filters.status, debouncedSearch, pagination.page, pagination.pageSize]);

  const statusFilter = filters.status || '';
  const isAvailable = statusFilter === 'available';
  const isClaimed = statusFilter === 'claimed';
  // `all` and `available` both send no status filter. `available` additionally routes
  // through the available-only query (pending + unclaimed); `all` spans every status so
  // a metadata facet search returns an order's escalations regardless of where they are.
  const apiStatus = isClaimed ? 'pending'
    : statusFilter === 'resolved' ? 'resolved'
    : statusFilter === 'cancelled' ? 'cancelled'
    : statusFilter === 'expired' ? 'expired'
    : isAvailable ? undefined
    : undefined;

  const sharedFilters = {
    role: filters.role || undefined,
    type: filters.type || undefined,
    priority: filters.priority ? parseInt(filters.priority) : undefined,
    limit: pagination.pageSize,
    offset: pagination.offset,
    sort_by: sort.sort_by || 'created_at',
    order: sort.order || 'desc',
    search: debouncedSearch || undefined,
    // Faceted metadata query (composes with role-scope + the basic filters in SQL).
    ...facetFilters,
  };

  const availableQuery = useAvailableEscalations({
    ...sharedFilters,
    enabled: isAvailable,
  });

  const escalationsQuery = useEscalations({
    status: apiStatus,
    claimed: isClaimed || undefined,
    ...sharedFilters,
    enabled: !isAvailable,
  });

  const activeQuery = isAvailable ? availableQuery : escalationsQuery;
  const { data, isLoading, error: queryError, refetch, isFetching } = activeQuery;

  // Copy-URL/curl path built from the SAME params the active query sends, so the
  // generated command always reproduces the real request (filters + search + sort).
  const apiPath = buildApiPath(`/escalations${isAvailable ? '/available' : ''}`, {
    status: apiStatus,
    claimed: isClaimed || undefined,
    role: filters.role || undefined,
    type: filters.type || undefined,
    priority: filters.priority || undefined,
    search: debouncedSearch || undefined,
    sort_by: sort.sort_by || 'created_at',
    order: sort.order || 'desc',
    limit: pagination.pageSize,
    offset: pagination.offset,
    // Faceted query — JSON-encoded so the copy-URL/curl reproduces the exact query.
    facets: facetFilters.facets && Object.keys(facetFilters.facets).length ? JSON.stringify(facetFilters.facets) : undefined,
    block: facetFilters.block?.length ? JSON.stringify(facetFilters.block) : undefined,
    range: facetFilters.range?.length ? JSON.stringify(facetFilters.range) : undefined,
    exists: facetFilters.exists?.length ? JSON.stringify(facetFilters.exists) : undefined,
    roles: facetFilters.roles?.length ? JSON.stringify(facetFilters.roles) : undefined,
    orderBy: facetFilters.orderBy?.length ? JSON.stringify(facetFilters.orderBy) : undefined,
    available: facetFilters.available != null ? String(facetFilters.available) : undefined,
  });

  // Search is server-side (full result set), so results and total come straight
  // from the query — no client-side filtering of the current page.
  const escalations = data?.escalations ?? [];
  const total = data?.total ?? 0;
  const { canBulk: canBulkManage } = useAccess();

  const selectedRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const esc of escalations) {
      if (selectedIds.has(esc.id)) roles.add(esc.role);
    }
    return [...roles];
  }, [escalations, selectedIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

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

  const {
    handleSetPriority,
    handleBulkClaim,
    handleBulkEscalate,
    handleBulkTriage,
    handleBulkAssign,
    handleBulkCancel,
  } = createBulkHandlers({
    selectedIds,
    clearSelection,
    setPriority,
    bulkClaim,
    bulkEscalate,
    bulkTriage,
    bulkAssign,
    bulkCancel,
    closeTriageModal: () => setTriageModalOpen(false),
    closeAssignModal: () => setAssignModalOpen(false),
    closeCancelModal: () => setCancelModalOpen(false),
  });

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

  const columns: Column<LTEscalationRecord>[] = [
    canBulkManage ? {
      key: 'select',
      label: (
        <input
          type="checkbox"
          checked={escalations.length > 0 && selectedIds.size === escalations.length}
          onChange={toggleAll}
          className="rounded"
        />
      ) as any,
      render: (row: LTEscalationRecord) => (
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
    } : {
      key: 'spacer',
      label: '',
      render: () => null,
      className: 'w-10',
    },
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
            colorClass="text-accent/75 hover:text-accent"
            size="sm"
          />
        </RowActionGroup>
      ),
      className: 'w-10 text-right',
    },
  ];

  return (
    <div>
      <PageHeader title="Available Escalations" docsHash="#docs:dashboard.md:all-escalations" />

      <EscalationFilterBar
        filters={filters}
        setFilter={setFilter}
        roles={rolesData?.roles ?? []}
        types={typesData?.types ?? []}
        showStatus
        showSearch={false}
        actions={
          <>
            <ListToolbar
              onRefresh={() => refetch()}
              isFetching={isFetching}
              apiPath={apiPath}
            />
            <button
              onClick={() => setFacetDrawerOpen((v) => !v)}
              className="relative ml-2 inline-flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:bg-surface-hover hover:text-text-primary transition-colors"
              title="Faceted query"
            >
              <SlidersHorizontal className="w-4 h-4" />
              {activeFacetCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-medium text-white">
                  {activeFacetCount}
                </span>
              )}
            </button>
          </>
        }
      />

      {/* Faceted query — slide-out drawer (deep-linked state), portaled so fixed positioning
          works. Always mounted so it slides open/closed with a subtle transition. */}
      {createPortal(
        <div
          className={`fixed right-0 bottom-0 w-[420px] z-40 border-l border-surface-border bg-surface overflow-y-auto shadow-lg transition-transform duration-200 ease-out ${facetDrawerOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}
          style={{ top: '3.5rem' }}
          aria-hidden={!facetDrawerOpen}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-surface border-b border-surface-border/50">
            <span className="text-xs font-medium text-text-primary">Faceted query</span>
            <div className="flex items-center gap-2">
              {activeFacetCount > 0 && (
                <button
                  onClick={() => { setFacetFilters({}); setFilter('search', ''); }}
                  className="text-[11px] text-text-tertiary hover:text-text-primary transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setFacetDrawerOpen(false)}
                className="p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="px-4 py-2">
            <p className="mb-2 text-[11px] leading-snug text-text-tertiary">
              Precise metadata facets plus exact correlation-id lookup — they compose in one
              SQL query. Facet keys are the ones that actually exist in your visible escalations.
              Set status to <span className="font-medium">All</span> to find an order across every
              status; the whole query is shareable via the URL.
            </p>
            <FacetedFilterPanel
              value={facetFilters}
              onChange={setFacetFilters}
              facetKeys={facetKeysData?.keys ?? []}
              search={filters.search ?? ''}
              onSearchChange={(v) => setFilter('search', v)}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* Always mounted so the bar can animate in AND out as the selection changes. */}
      <BulkActionBar
        selectedCount={selectedIds.size}
          onClearSelection={() => setSelectedIds(new Set())}
          onSetPriority={handleSetPriority}
          onClaim={handleBulkClaim}
          onAssign={() => setAssignModalOpen(true)}
          onEscalate={handleBulkEscalate}
          onTriage={() => setTriageModalOpen(true)}
          onCancel={() => setCancelModalOpen(true)}
          isPriorityPending={setPriority.isPending}
          isClaimPending={bulkClaim.isPending}
          isAssignPending={bulkAssign.isPending}
          isEscalatePending={bulkEscalate.isPending}
          isTriagePending={bulkTriage.isPending}
          isCancelPending={bulkCancel.isPending}
          availableRoles={rolesData?.roles ?? []}
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
        data={escalations}
        keyFn={(row) => row.id}
        onRowClick={(row) => navigate(`/escalations/detail/${row.id}`, { state: { from: '/escalations/available' } })}
        isLoading={isLoading}
        emptyMessage={queryError ? 'Unable to load data' : 'No available escalations'}
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

      <ClaimModal
        claimTarget={claimTarget}
        onClose={() => setClaimTarget(null)}
        claimDuration={claimDuration}
        onDurationChange={(v) => { setClaimDuration(v); setCustomClaimMinutes(0); }}
        claimDurations={claimDurations}
        customClaimMinutes={customClaimMinutes}
        onCustomClaimChange={onCustomClaimChange}
        onClaim={handleClaim}
        isPending={claim.isPending}
      />

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

      <ConfirmCancelModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirm={handleBulkCancel}
        selectedCount={selectedIds.size}
        isPending={bulkCancel.isPending}
        error={bulkCancel.error as Error | null}
      />
    </div>
  );
}
