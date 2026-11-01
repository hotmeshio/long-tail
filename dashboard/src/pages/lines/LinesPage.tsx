import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  MACHINE_LINE_INDEX_QUERY_KEY,
  MACHINE_LINES_QUERY_KEY,
  machineLinePattern,
  machineLogPattern,
  useLineIndex,
  type LineIndexRow,
  type LineSort,
} from '../../api/machines';
import { DataTable } from '../../components/common/data/DataTable';
import { FilterBar, FilterInput, FilterSelect } from '../../components/common/data/FilterBar';
import { StickyPagination } from '../../components/common/data/StickyPagination';
import { PageHeader } from '../../components/common/layout/PageHeader';
import { useAccess } from '../../hooks/useAccess';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useEventSubscriptions } from '../../hooks/useEventContext';
import { useThrottledInvalidation } from '../../hooks/useEventHooks';
import { useFilterParams } from '../../hooks/useFilterParams';
import { useShellPanelOptional } from '../../hooks/useShellPanel';
import { LineDeclarePanel, DECLARE_PANEL_KEY, DECLARE_PANEL_WIDTH } from './LineDeclarePanel';
import { lineColumns, linePath } from './LineIndexColumns';
import { groupBySite, SORT_OPTIONS, type SiteGroup } from './line-index';

const PAGE_SIZE = 50;
const SETTINGS_QUERY_KEY = 'settings';
const ATTENTION_ON = 'true';
const DEFAULT_SORT: LineSort = 'attention';

const COPY = {
  undeclared: 'Lines appear here once the server declares them.',
  none: 'No lines declared yet.',
  noMatch: 'No line matches.',
  loading: 'Loading lines…',
} as const;

/** The index refreshes through the LIST tier when a line is declared or retired, or a gateway logs. */
function useIndexRefresh() {
  const invalidate = useThrottledInvalidation('LIST');
  const patterns = useMemo(() => [machineLinePattern(), machineLogPattern()], []);
  useEventSubscriptions(patterns, () => {
    invalidate([[MACHINE_LINE_INDEX_QUERY_KEY], [MACHINE_LINES_QUERY_KEY], [SETTINGS_QUERY_KEY]]);
  });
}

function SiteHeading({ group }: { group: SiteGroup }) {
  return (
    <div className="flex items-baseline gap-3 pt-5 pb-1.5" data-testid="site-heading">
      <span className="text-xs font-mono text-text-primary">{group.siteId}</span>
      <span className="text-2xs text-text-quaternary tabular-nums">
        {group.lines.length} line{group.lines.length === 1 ? '' : 's'}
      </span>
      {group.attention > 0 && (
        <span className="text-2xs text-status-warning tabular-nums">{group.attention} need{group.attention === 1 ? 's' : ''} attention</span>
      )}
    </div>
  );
}

/**
 * Every declared line across every site: searchable, paged on the server,
 * trouble first, grouped by site until a search or a site narrows the page.
 */
export function LinesPage() {
  const navigate = useNavigate();
  const { isOps, isBuilder } = useAccess();
  const canDeclare = isOps || isBuilder;
  const shell = useShellPanelOptional();
  const invalidate = useThrottledInvalidation('LIST');
  const { filters, setFilter, pagination } = useFilterParams({
    filters: { q: '', site: '', attention: '', sort: '' },
    pageSize: PAGE_SIZE,
  });
  const q = useDebouncedValue(filters.q);
  const attention = filters.attention === ATTENTION_ON;
  const sort = (SORT_OPTIONS.some((o) => o.value === filters.sort) ? filters.sort : DEFAULT_SORT) as LineSort;

  const params = useMemo(
    () => ({ q: q || undefined, site: filters.site || undefined, attention: attention || undefined, sort, limit: pagination.pageSize, offset: pagination.offset }),
    [q, filters.site, attention, sort, pagination.pageSize, pagination.offset],
  );
  const { data, isLoading, error } = useLineIndex(params);
  useIndexRefresh();

  const refresh = useCallback(() => {
    invalidate([[MACHINE_LINE_INDEX_QUERY_KEY], [MACHINE_LINES_QUERY_KEY], [SETTINGS_QUERY_KEY]]);
  }, [invalidate]);

  const closeDeclare = useCallback(() => shell?.closePanel(DECLARE_PANEL_KEY), [shell]);
  const openDeclare = useCallback(
    (initial: LineIndexRow | null) => {
      shell?.setPanel(
        <LineDeclarePanel initial={initial} onClose={closeDeclare} onDone={refresh} />,
        { key: DECLARE_PANEL_KEY, width: DECLARE_PANEL_WIDTH },
      );
    },
    [shell, closeDeclare, refresh],
  );
  useEffect(() => () => shell?.closePanel(DECLARE_PANEL_KEY), [shell]);

  const columns = useMemo(() => lineColumns(canDeclare ? (row) => openDeclare(row) : null), [canDeclare, openDeclare]);
  const grouped = !q && !filters.site;
  const groups = useMemo(() => (grouped && data ? groupBySite(data.lines) : []), [grouped, data]);
  const total = data?.total ?? 0;
  const activeFilters = [filters.q, filters.site, filters.attention].filter(Boolean).length;
  const emptyMessage = !data?.declared ? COPY.undeclared : activeFilters > 0 ? COPY.noMatch : COPY.none;
  const openRow = (row: LineIndexRow) => navigate(linePath(row));

  return (
    <div>
      <PageHeader title="Lines" />
      <FilterBar
        activeFilterCount={activeFilters}
        actions={
          <>
            <span className="text-2xs text-text-quaternary tabular-nums whitespace-nowrap">
              {total} line{total === 1 ? '' : 's'}
            </span>
            {canDeclare && (
              <button type="button" onClick={() => openDeclare(null)} className="inline-flex items-center gap-1 text-2xs icon-link whitespace-nowrap">
                <Plus className="w-3 h-3" />
                Declare line
              </button>
            )}
          </>
        }
      >
        <FilterInput label="Search" value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="site, line, machine, process, address" />
        <FilterSelect
          label="Site"
          value={filters.site}
          onChange={(v) => setFilter('site', v)}
          options={(data?.sites ?? []).map((s) => ({ value: s.siteId, label: `${s.siteId} · ${s.lines} line${s.lines === 1 ? '' : 's'}` }))}
          placeholder="every site"
        />
        <FilterSelect label="Order" value={sort} onChange={(v) => setFilter('sort', v)} options={SORT_OPTIONS} required />
        <button
          type="button"
          aria-pressed={attention}
          onClick={() => setFilter('attention', attention ? '' : ATTENTION_ON)}
          className={`self-start px-2 py-1 text-2xs rounded border transition-colors whitespace-nowrap ${
            attention ? 'border-status-warning text-status-warning' : 'border-surface-border text-text-secondary hover:text-text-primary'
          }`}
        >
          Needs attention
        </button>
      </FilterBar>

      {error && <p className="text-2xs text-status-error mb-4">{(error as Error).message}</p>}
      {isLoading ? (
        <p className="text-2xs text-text-tertiary italic">{COPY.loading}</p>
      ) : grouped && groups.length > 0 ? (
        groups.map((group) => (
          <section key={group.siteId} aria-label={group.siteId}>
            <SiteHeading group={group} />
            <DataTable columns={columns} data={group.lines} keyFn={(row) => `${row.siteId}/${row.lineId}`} onRowClick={openRow} layout="fixed" inline />
          </section>
        ))
      ) : (
        <DataTable
          columns={columns}
          data={data?.lines ?? []}
          keyFn={(row) => `${row.siteId}/${row.lineId}`}
          onRowClick={openRow}
          layout="fixed"
          emptyMessage={emptyMessage}
        />
      )}

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
