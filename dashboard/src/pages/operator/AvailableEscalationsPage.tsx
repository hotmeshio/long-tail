import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { parseFacetParams, writeFacetParams, facetCount } from '../../lib/facet-url';
import { useAccess } from '../../hooks/useAccess';
import { useAuth } from '../../hooks/useAuth';
import { isSystemTierRole } from '../../lib/task-queues';
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
  type FacetOrder,
} from '../../api/escalations';
import { FacetQueryPanel } from './FacetQueryPanel';
import { useShellPanel } from '../../hooks/useShellPanel';
import { ConfirmCancelModal } from '../../components/common/modal/ConfirmCancelModal';
import { useRoles, useRoleDetails, useRoleListSchema } from '../../api/roles';
import { displayRoleTitle } from '../../lib/role-display';
import { EscalationTitleSelect } from './EscalationTitleSelect';
import { EscalationSortControl } from './EscalationSortControl';
import { EscalationListView } from '../../components/escalation/EscalationListView';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { buildApiPath } from '../../lib/api-path';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { BulkActionBar } from '../../components/common/modal/BulkActionBar';
import { BulkAssignModal } from '../../components/common/modal/BulkAssignModal';
import { BulkTriageModal } from '../../components/common/modal/BulkTriageModal';
import { useClaimDurations } from '../../hooks/useClaimDurations';
import { Activity, Lock, SlidersHorizontal, X, LayoutList, Table, BookOpen, TriangleAlert, Pin } from 'lucide-react';
import { usePatchPreferences, usePreferences } from '../../api/preferences';
import { newPinId } from '../../lib/pinned-views';
import { formatDurationCompact } from '../../lib/format';
import { makeEscalationColumns, EscalationFilterBar } from './escalation-columns';
import { RowAction, RowActionGroup } from '../../components/common/layout/RowActions';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { createBulkHandlers } from './helpers';
import { ClaimModal } from './ClaimModal';
import { EscalationTimeline } from '../../components/escalation/EscalationTimeline';
import type { LTEscalationRecord } from '../../api/types';

export function AvailableEscalationsPage() {
  useEscalationListEvents();
  const navigate = useNavigate();
  const { filters, setFilter, pagination } = useFilterParams({
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
    });
  }, [setSearchParams]);
  const { data: facetKeysData } = useFacetKeys(facetDrawerOpen);
  // The free-text term now lives in the drawer alongside the facets, so it counts
  // toward the active-query badge and is cleared by the drawer's Clear.
  const activeFacetCount = facetCount(facetFilters) + (filters.search ? 1 : 0);

  // Faceted query editor rides the shell's global right panel. Re-invoked on
  // every dependency change so the panel content always reflects live state.
  // The slot is shared (the folded FilterBar claims it too), so every call is
  // keyed: claiming is intentional, closing only closes our own content.
  const FACET_PANEL_KEY = 'facet-query';
  const { setPanel, closePanel, open: panelOpen, ownerKey } = useShellPanel();
  useEffect(() => {
    if (!facetDrawerOpen) {
      closePanel(FACET_PANEL_KEY);
      return;
    }
    setPanel(
      <FacetQueryPanel
        value={facetFilters}
        onChange={setFacetFilters}
        facetKeys={facetKeysData?.keys ?? []}
        search={filters.search ?? ''}
        onSearchChange={(v) => setFilter('search', v)}
        activeFacetCount={activeFacetCount}
        onClear={() => { setFacetFilters({}); setFilter('search', ''); }}
        onClose={() => setFacetDrawerOpen(false)}
      />,
      { width: 420, key: FACET_PANEL_KEY },
    );
  }, [facetDrawerOpen, facetFilters, setFacetFilters, facetKeysData, filters.search, setFilter, activeFacetCount, setPanel, closePanel]);

  // Stand down when another claimant takes the slot — drop the drawer flag so
  // the live-update effect above doesn't reclaim on its next dependency change.
  const ownsFacetPanel = panelOpen && ownerKey === FACET_PANEL_KEY;
  const ownedFacetRef = useRef(false);
  useEffect(() => {
    if (ownsFacetPanel) {
      ownedFacetRef.current = true;
      return;
    }
    if (ownedFacetRef.current) {
      ownedFacetRef.current = false;
      setFacetDrawerOpen(false);
    }
  }, [ownsFacetPanel]);
  const [triageModalOpen, setTriageModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  // One sort model for every view: orderBy is deep-linked in the URL and routes
  // the request through the robust faceted path (hasFacetQuery is true whenever
  // orderBy is set). Default is created_at desc when no orderBy is present.
  const setOrderBy = useCallback(
    (next: FacetOrder[] | undefined) => setFacetFilters({ ...facetFilters, orderBy: next }),
    [facetFilters, setFacetFilters],
  );

  // Pin current view: capture the live URL (every filter — role, status,
  // facets, orderBy, view, jeopardy — is already deep-linked) as a pinned
  // view, prompting only for the label. Badged by default: a pinned query's
  // live count is its value.
  const location = useLocation();
  const { data: prefsData } = usePreferences();
  const patchPrefs = usePatchPreferences();
  const pinCurrentView = useCallback(() => {
    const label = window.prompt('Pin label:');
    if (!label?.trim()) return;
    const existing = prefsData?.preferences?.pinnedViews ?? [];
    patchPrefs.mutate({
      pinnedViews: [
        ...existing,
        { id: newPinId(), label: label.trim(), url: location.pathname + location.search, badge: true },
      ],
    });
  }, [location.pathname, location.search, prefsData, patchPrefs]);

  const { canBulk: canBulkManage } = useAccess();
  const facetHighlightKeys = facetFilters.facets ? Object.keys(facetFilters.facets) : [];

  // View mode is DEEP-LINKED (?view=table|timeline|rich) and tied to the filter-bar
  // toggles — a shared link reproduces the exact presentation. Explicit param wins;
  // absent, the page auto-picks: timeline when a filter narrows the set, else the
  // role's rich list view when one exists, else the table.
  const viewParam = searchParams.get('view');
  const setViewParam = useCallback((v: 'table' | 'timeline' | 'rich' | null) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (v) p.set('view', v); else p.delete('view');
      return p;
    }, { replace: true });
  }, [setSearchParams]);
  const showTimeline = viewParam ? viewParam === 'timeline' : activeFacetCount > 0;

  // Remove a single facet key from the active query.
  const removeFacet = useCallback((key: string) => {
    const { [key]: _removed, ...rest } = facetFilters.facets ?? {};
    setFacetFilters({ ...facetFilters, facets: Object.keys(rest).length > 0 ? rest : undefined });
  }, [facetFilters, setFacetFilters]);

  const claim = useClaimEscalation();
  const setPriority = useSetEscalationPriority();
  const bulkClaim = useBulkClaimEscalations();
  const bulkAssign = useBulkAssignEscalations();
  const bulkEscalate = useBulkEscalateToRole();
  const bulkTriage = useBulkTriageEscalations();
  const bulkCancel = useBulkCancelEscalations();
  const { data: rolesData } = useRoles();
  const { data: roleDetails } = useRoleDetails();
  const { data: typesData } = useEscalationTypes();
  const { user, isSuperAdmin, hasRoleType } = useAuth();
  // Global viewers (superadmin / admin) can filter any queue; a scoped user sees
  // only the queues they belong to — the title menu never offers a role whose
  // escalations they can't read.
  const isGlobalViewer = isSuperAdmin || hasRoleType('admin');
  const memberRoleSet = useMemo(() => new Set((user?.roles ?? []).map((r) => r.role)), [user]);
  const roleOptions = useMemo(() => {
    const all = roleDetails?.roles ?? [];
    const visible = isGlobalViewer
      ? all
      : all.filter((r) => memberRoleSet.has(r.role) && !isSystemTierRole(r.role));
    return visible
      .map((r) => ({ value: r.role, label: displayRoleTitle(r) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [roleDetails, isGlobalViewer, memberRoleSet]);

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

  // Timeline mode fetches 100 per page so the spine has enough story to tell.
  const timelinePageSize = 100;
  const sharedFilters = {
    role: filters.role || undefined,
    type: filters.type || undefined,
    priority: filters.priority ? parseInt(filters.priority) : undefined,
    limit: showTimeline ? timelinePageSize : pagination.pageSize,
    offset: pagination.offset,
    // Basic-path fallback only; when orderBy is present (any real sort) the
    // request routes faceted and orderBy drives the ordering instead.
    sort_by: 'created_at',
    order: 'desc',
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
    sort_by: 'created_at',
    order: 'desc',
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
  // Role-owned rich view: only when the list targets exactly ONE role (the basic
  // filter, or a single faceted role) and that role owns a list_schema. Absent
  // or multi-role → the engineer table, unchanged. `forceTable` lets the user
  // flip back to the columns.
  const singleRole = filters.role
    || (facetFilters.roles?.length === 1 ? facetFilters.roles[0] : null);
  const listSchemaQuery = useRoleListSchema(singleRole ?? '', undefined, !!singleRole);
  const listSchema = (listSchemaQuery.data?.list_schema ?? null) as Record<string, any> | null;
  // A rich view is available for this list; the toggle flips to the table.
  const hasRichView = !!singleRole && !!listSchema
    && !!listSchema['x-lt-layout'] && listSchema['x-lt-layout'] !== 'table';
  const useRichView = hasRichView && !showTimeline
    && (viewParam ? viewParam === 'rich' : true);

  // The jeopardy pill names the role's limit so the red filter is self-explaining
  // ("in jeopardy · > 15m"): priority_threshold_minutes, falling back to SLA.
  const jeopardyThresholdLabel = useMemo(() => {
    if (!facetFilters.jeopardy || !singleRole) return null;
    const r = (roleDetails?.roles ?? []).find((x) => x.role === singleRole);
    const mins = r?.priority_threshold_minutes ?? r?.sla_minutes ?? null;
    return mins != null ? formatDurationCompact(mins * 60_000) : null;
  }, [facetFilters.jeopardy, singleRole, roleDetails]);

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
      priority: 1,
    } : {
      key: 'spacer',
      label: '',
      render: () => null,
      className: 'w-10',
      priority: 3,
    },
    ...makeEscalationColumns({ highlightKeys: facetHighlightKeys }),
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
      {/* The title IS the queue selector: it reads as the chosen role's title,
          or "All Escalations". The role filter therefore leaves the bar. */}
      <div className="flex items-center gap-2 mb-10 min-w-0">
        <EscalationTitleSelect role={filters.role} options={roleOptions} onChange={(v) => setFilter('role', v)} />
        <button
          onClick={() => { window.location.hash = '#docs:dashboard.md:all-escalations'; }}
          className="text-text-quaternary hover:text-accent transition-colors mt-1 shrink-0"
          title="Open docs for this page"
        >
          <BookOpen className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>

      <EscalationFilterBar
        filters={filters}
        setFilter={setFilter}
        roles={rolesData?.roles ?? []}
        types={typesData?.types ?? []}
        showStatus
        showSearch={false}
        actions={
          <>
            {showTimeline && (
              <span className="text-2xs text-text-tertiary whitespace-nowrap">
                {total > 100 && (
                  <><span className="font-medium text-text-secondary">{(pagination.page - 1) * 100 + 1}–{Math.min(pagination.page * 100, total)}</span>{' of '}</>
                )}
                <span className="font-medium text-text-secondary">{total}</span>{' '}
                {total === 1 ? 'escalation' : 'escalations'}
              </span>
            )}
            {/* Universal sort — one control for table, timeline, and rich views. */}
            <EscalationSortControl orderBy={facetFilters.orderBy} onChange={setOrderBy} />
            <span className="h-3.5 w-px bg-surface-border shrink-0" />
            <ListToolbar
              onRefresh={() => refetch()}
              isFetching={isFetching}
              apiPath={apiPath}
            />
            {hasRichView && !showTimeline && (
              <button
                onClick={() => setViewParam(useRichView ? 'table' : 'rich')}
                className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:bg-surface-hover hover:text-text-primary transition-colors"
                title={useRichView ? 'Table view' : 'Rich view'}
              >
                {useRichView
                  ? <Table className="w-4 h-4" />
                  : <LayoutList className="w-4 h-4" />}
              </button>
            )}
            {activeFacetCount > 0 && (
              <button
                onClick={() => setViewParam(showTimeline ? 'table' : 'timeline')}
                className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:bg-surface-hover hover:text-text-primary transition-colors"
                title={showTimeline ? 'Table view' : 'Timeline view'}
              >
                {showTimeline
                  ? <Table className="w-4 h-4" />
                  : <Activity className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={pinCurrentView}
              className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:bg-surface-hover hover:text-accent transition-colors"
              title="Pin this view — save the current filters to your Pinned section"
              data-testid="pin-current-view"
            >
              <Pin className="w-4 h-4" />
            </button>
            <button
              onClick={() => setFacetDrawerOpen((v) => !v)}
              className="relative ml-2 inline-flex h-7 w-7 items-center justify-center rounded text-text-tertiary hover:bg-surface-hover hover:text-text-primary transition-colors"
              title="Faceted query"
            >
              <SlidersHorizontal className="w-4 h-4" />
              {activeFacetCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-accent px-0.5 text-2xs font-medium text-text-inverse">
                  {activeFacetCount}
                </span>
              )}
            </button>
          </>
        }
      />

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

      {/* Active facet pills — sticky below the shell header, opaque so timeline scrolls beneath */}
      {((facetFilters.facets && Object.keys(facetFilters.facets).length > 0) || facetFilters.jeopardy) && (
        <div className="sticky top-14 z-30 bg-surface/98 backdrop-blur-sm border-b border-surface-border/30 -mx-page-x px-page-x py-2 flex items-center gap-1.5 flex-wrap">
          {facetFilters.jeopardy && (
            <span className="inline-flex items-center gap-1 rounded-full bg-status-error px-2.5 py-0.5 text-2xs font-semibold text-text-inverse">
              <TriangleAlert className="w-2.5 h-2.5" strokeWidth={2.5} />
              in jeopardy
              {jeopardyThresholdLabel && <span className="font-mono font-normal opacity-90">&gt; {jeopardyThresholdLabel}</span>}
              <button
                onClick={() => setFacetFilters({ ...facetFilters, jeopardy: undefined })}
                className="ml-0.5 -mr-0.5 flex items-center text-text-inverse/70 hover:text-text-inverse transition-colors"
                aria-label="Clear jeopardy filter"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}
          {Object.entries(facetFilters.facets ?? {}).map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/8 px-2.5 py-0.5 text-2xs font-medium text-accent/90"
            >
              <span className="font-mono text-text-tertiary">{k}</span>
              <span className="text-text-quaternary">=</span>
              <span className="font-mono max-w-[160px] truncate" title={String(v)}>{String(v)}</span>
              <button
                onClick={() => removeFacet(k)}
                className="ml-0.5 -mr-0.5 flex items-center text-text-quaternary hover:text-status-error transition-colors"
                aria-label={`Remove ${k} filter`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          {Object.keys(facetFilters.facets ?? {}).length > 1 && (
            <button
              onClick={() => setFacetFilters({ ...facetFilters, facets: undefined })}
              className="text-2xs text-text-quaternary hover:text-text-secondary transition-colors px-1"
            >
              clear all
            </button>
          )}
        </div>
      )}

      {queryError && (
        <div className="mb-4 px-4 py-3 rounded-md bg-status-error/10 border border-status-error/20 text-xs text-status-error">
          {(queryError as Error).message === 'Session expired'
            ? 'Your session has expired. Please log in again.'
            : `Failed to load escalations: ${(queryError as Error).message}`}
        </div>
      )}

      {showTimeline ? (
        <EscalationTimeline
          escalations={escalations}
          highlightKeys={facetHighlightKeys}
          onRowClick={(row) => navigate(`/escalations/detail/${row.id}`, { state: { from: '/escalations/available' } })}
          total={total}
          page={pagination.page}
          totalPages={Math.ceil(total / timelinePageSize)}
          onPageChange={pagination.setPage}
        />
      ) : useRichView ? (
        <EscalationListView
          role={singleRole!}
          listSchema={listSchema!}
          activeEscalations={escalations}
          onRowClick={(row) => navigate(`/escalations/detail/${row.id}`, { state: { from: '/escalations/available' } })}
          onOpenGroup={(url) => navigate(url)}
          onAddFacet={(key, value) => setFacetFilters({
            ...facetFilters,
            // Same native-type handling as metadataFacetUrl: objects stringify,
            // primitives keep their type so JSONB containment stays type-correct.
            facets: {
              ...(facetFilters.facets ?? {}),
              [key]: typeof value === 'object' && value !== null ? JSON.stringify(value) : value,
            },
          })}
          total={total}
          page={pagination.page}
          totalPages={pagination.totalPages(total)}
          pageSize={pagination.pageSize}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={escalations}
            layout="fixed"
            keyFn={(row) => row.id}
            onRowClick={(row) => navigate(`/escalations/detail/${row.id}`, { state: { from: '/escalations/available' } })}
            isLoading={isLoading}
            emptyMessage={queryError ? 'Unable to load data' : 'No escalations'}
          />

          <StickyPagination
            page={pagination.page}
            totalPages={pagination.totalPages(total)}
            onPageChange={pagination.setPage}
            total={total}
            pageSize={pagination.pageSize}
            onPageSizeChange={pagination.setPageSize}
          />
        </>
      )}

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
