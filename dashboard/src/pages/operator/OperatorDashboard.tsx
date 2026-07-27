import { useCallback, useMemo } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { LockOpen, Pin, LayoutList, Table, BookOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useEscalations, useEscalationTypes, useReleaseEscalation } from '../../api/escalations';
import { useEscalationListEvents } from '../../hooks/useEventHooks';
import { useRoles, useRoleDetails, useRoleListSchema } from '../../api/roles';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { buildApiPath } from '../../lib/api-path';
import { isSystemTierRole } from '../../lib/task-queues';
import { displayRoleTitle } from '../../lib/role-display';
import { DataTable, type Column } from '../../components/common/data/DataTable';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { RowAction, RowActionGroup } from '../../components/common/layout/RowActions';
import { ESCALATION_COLUMNS, TIME_LEFT_COLUMN, EscalationFilterBar } from './escalation-columns';
import { EscalationTitleSelect } from './EscalationTitleSelect';
import { ListToolbar } from '../../components/common/data/ListToolbar';
import { EscalationListView } from '../../components/escalation/EscalationListView';
import { usePatchPreferences, usePreferences } from '../../api/preferences';
import { newPinId } from '../../lib/pinned-views';
import type { LTEscalationRecord } from '../../api/types';

export function OperatorDashboard() {
  const navigate = useNavigate();
  const { user, isSuperAdmin, hasRoleType } = useAuth();
  const { filters, setFilter, pagination, sort, setSort } = useFilterParams({
    filters: { role: '', type: '', priority: '', search: '' },
  });
  // The personal inbox moves on claims arriving and work leaving — claimed
  // and resolved. A role filter narrows the subscription to that queue's
  // subject token; nothing else in the escalation space reaches this page.
  useEscalationListEvents({ role: filters.role || null, verbs: ['claimed', 'resolved'] });
  // Debounce so server-side search fires once the user pauses, not per keystroke.
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const release = useReleaseEscalation();
  const { data: rolesData } = useRoles();
  const { data: typesData } = useEscalationTypes();

  // The title doubles as the queue selector, reading as the chosen role's
  // friendly title — the same control the All Escalations page carries, over
  // the same ?role= param the filter bar mirrors.
  const { data: roleDetails } = useRoleDetails();
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

  // Pin current view — the same gesture as All Escalations: every filter is
  // already deep-linked in the URL, so a pin is just the labeled URL.
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

  // Role-owned rich view — the same resolution the queue page runs, applied to
  // the personal inbox when one role is filtered. Deep-linked (?view=rich|table)
  // so a pinned link reproduces the presentation; absent, rich wins when the
  // role owns a non-table list_schema. Row actions render in view mode: every
  // row here is already held by the viewer, so claim gestures don't apply.
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const setViewParam = useCallback((v: 'table' | 'rich' | null) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (v) p.set('view', v); else p.delete('view');
      return p;
    }, { replace: true });
  }, [setSearchParams]);
  const singleRole = filters.role || null;
  const listSchemaQuery = useRoleListSchema(singleRole ?? '', undefined, !!singleRole);
  const listSchema = (listSchemaQuery.data?.list_schema ?? null) as Record<string, any> | null;
  const hasRichView = !!singleRole && !!listSchema
    && !!listSchema['x-lt-layout'] && listSchema['x-lt-layout'] !== 'table';
  const useRichView = hasRichView && (viewParam ? viewParam === 'rich' : true);

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
          alwaysVisible
          colorClass="text-status-warning/40 hover:text-status-warning"
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

  const openDetail = (row: LTEscalationRecord) =>
    navigate(`/escalations/detail/${row.id}`, { state: { from: '/escalations/queue' } });

  return (
    <div>
      {/* The title IS the queue selector: it reads as the chosen role's title,
          or "My Escalations" — the personal inbox, narrowed the same way the
          All Escalations page narrows. */}
      <div className="flex items-center gap-2 mb-10 min-w-0">
        <EscalationTitleSelect
          role={filters.role}
          options={roleOptions}
          onChange={(v) => setFilter('role', v)}
          emptyLabel="My Escalations"
        />
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
        actions={
          <>
            <ListToolbar
              onRefresh={() => refetch()}
              isFetching={isFetching}
              apiPath={apiPath}
            />
            {hasRichView && (
              <button
                onClick={() => setViewParam(useRichView ? 'table' : 'rich')}
                className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded icon-link hover:bg-surface-hover"
                title={useRichView ? 'Table view' : 'Rich view'}
              >
                {useRichView
                  ? <Table className="w-4 h-4" />
                  : <LayoutList className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={pinCurrentView}
              className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded icon-link hover:bg-surface-hover"
              title="Pin this view — save the current filters to your Pinned section"
              data-testid="pin-current-view"
            >
              <Pin className="w-4 h-4" />
            </button>
          </>
        }
      />

      {queryError && (
        <div className="mb-4 px-4 py-3 rounded-md bg-status-error/10 border border-status-error/20 text-xs text-status-error">
          {(queryError as Error).message === 'Session expired'
            ? 'Your session has expired. Please log in again.'
            : `Failed to load escalations: ${(queryError as Error).message}`}
        </div>
      )}

      {useRichView ? (
        <EscalationListView
          role={singleRole!}
          listSchema={listSchema!}
          activeEscalations={activeClaims}
          onRowClick={openDetail}
          forceViewAction
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
            data={activeClaims}
            layout="fixed"
            keyFn={(row) => row.id}
            onRowClick={openDetail}
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
        </>
      )}
    </div>
  );
}
