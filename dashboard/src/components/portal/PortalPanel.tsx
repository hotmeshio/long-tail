import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, LayoutList, Pin, RefreshCw, Table } from 'lucide-react';
import type { RolePin } from '../../api/roles';
import type { FacetOrder } from '../../api/escalations';
import type { LTEscalationRecord } from '../../api/types';
import { useEscalationListQuery } from '../../hooks/useEscalationListQuery';
import { LIST_VIEWS, parseEscalationListUrl, resolveListView, type EscalationListParams, type ListView } from '../../lib/escalation-list-url';
import { EscalationSortControl } from '../../pages/operator/EscalationSortControl';
import { formatCountCompact } from '../../lib/format';
import { EscalationListView } from '../escalation/EscalationListView';
import { EscalationTimeline } from '../escalation/EscalationTimeline';
import { EscalationTableView } from '../escalation/EscalationTableView';

/** Rows a panel shows before pointing at the full view. */
export const PORTAL_PANEL_ROWS = 25;
const PANEL_STALE_MS = 15_000;
const NO_LIST: EscalationListParams = { statusFilter: '', facets: {}, view: null, layout: null };
// Table headers stick to the panel's own scroll, not the shell's offset.
const PANEL_STYLE = { '--lt-sticky-top': '0px' } as CSSProperties;

/**
 * One portal cell: a pinned list view rendered live. The pin's URL is parsed
 * into the same query the list page runs and drawn with the same components,
 * so the panel and the page it opens onto always agree. No filters, no
 * selection, no pagination: the label, the count, a refresh, and the rows.
 * Each panel is its own bounded sheet, the section recipe (sunken surface,
 * border, section radius), so the portal reads as distinct segments. Two
 * light controls let a person at the screen adapt a panel: the view (table or
 * the role's rich view) and the sort direction. They hold for the visit only;
 * the pin stays as authored.
 */
export function PortalPanel({ pin, url, from }: {
  pin: RolePin;
  /** The pin's URL with link variables already resolved. */
  url: string;
  /** Where a detail page opened from here returns to. */
  from: string;
}) {
  const navigate = useNavigate();
  const pinParams = useMemo(() => parseEscalationListUrl(url), [url]);
  // Visit-local adaptations over the pin: a chosen view, a chosen sort direction.
  const [chosenView, setChosenView] = useState<ListView | null>(null);
  const [chosenOrder, setChosenOrder] = useState<FacetOrder[] | undefined>(undefined);
  const orderBy = chosenOrder ?? pinParams?.facets.orderBy;
  const params = useMemo<EscalationListParams | null>(() => {
    if (!pinParams) return null;
    if (orderBy === pinParams.facets.orderBy) return pinParams;
    return { ...pinParams, facets: { ...pinParams.facets, orderBy } };
  }, [pinParams, orderBy]);
  const list = useEscalationListQuery(params ?? NO_LIST, {
    limit: PORTAL_PANEL_ROWS,
    offset: 0,
    staleTime: PANEL_STALE_MS,
    enabled: params !== null,
  });
  const view = params ? resolveListView(chosenView ?? params.view, list.hasRichView) : null;
  const highlightKeys = useMemo(() => Object.keys(params?.facets.facets ?? {}), [params]);
  const openRow = (row: LTEscalationRecord) => navigate(`/escalations/detail/${row.id}`, { state: { from } });
  const more = Math.max(0, list.total - list.escalations.length);

  return (
    <section
      className="min-h-0 flex flex-col overflow-hidden border border-surface-border bg-surface-sunken rounded-[var(--lt-radius-section)]"
      style={PANEL_STYLE}
      data-testid="portal-panel"
    >
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 shrink-0 border-b border-surface-border bg-surface-hover">
        <div className="flex items-center gap-2 min-w-0">
          <Pin className="w-3.5 h-3.5 shrink-0 text-accent/60" strokeWidth={1.5} />
          <h2 className="section-h2 truncate" title={pin.label}>{pin.label}</h2>
          {params && list.total > 0 && (
            <span className="text-2xs tabular-nums text-text-tertiary" data-testid="portal-panel-count">
              {formatCountCompact(list.total)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {params && view !== LIST_VIEWS.TIMELINE && list.hasRichView && (
            <div role="radiogroup" aria-label="Panel view" className="flex items-center rounded overflow-hidden border border-surface-border">
              {[
                { key: LIST_VIEWS.TABLE, title: 'Table view', Icon: Table },
                { key: LIST_VIEWS.RICH, title: 'Rich view', Icon: LayoutList },
              ].map(({ key, title, Icon }) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={view === key}
                  onClick={() => setChosenView(key)}
                  className={`px-1.5 py-1 transition-colors ${view === key ? 'bg-accent text-text-inverse' : 'icon-link hover:bg-surface-raised'}`}
                  title={title}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          )}
          {params && <EscalationSortControl orderBy={orderBy} onChange={setChosenOrder} />}
          {params && (
            <button
              type="button"
              onClick={list.refetch}
              disabled={list.isFetching}
              className="inline-flex h-7 w-7 items-center justify-center rounded icon-link hover:bg-surface-hover disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${list.isFetching ? 'animate-spin' : ''}`} />
            </button>
          )}
          <Link
            to={url}
            className="inline-flex h-7 w-7 items-center justify-center rounded icon-link hover:bg-surface-hover"
            title="Open the full view"
            data-testid="portal-panel-open"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto @container px-4 py-3">
        {!params ? (
          <p className="py-6 text-center text-xs text-text-quaternary">
            <Link to={url} className="text-accent hover:underline">{pin.label}</Link> opens as its own page.
          </p>
        ) : list.error ? (
          <p className="py-6 text-center text-xs text-status-error" role="alert">
            Failed to load: {list.error.message}
          </p>
        ) : view === LIST_VIEWS.TIMELINE ? (
          <EscalationTimeline
            escalations={list.escalations}
            highlightKeys={highlightKeys}
            onRowClick={openRow}
            total={list.total}
            page={1}
            totalPages={1}
            onPageChange={() => {}}
          />
        ) : view === LIST_VIEWS.RICH ? (
          <EscalationListView
            role={list.singleRole!}
            listSchema={list.listSchema!}
            activeEscalations={list.escalations}
            onRowClick={openRow}
            onOpenGroup={(target) => navigate(target)}
          />
        ) : (
          <EscalationTableView
            escalations={list.escalations}
            highlightKeys={highlightKeys}
            onRowClick={openRow}
            isLoading={list.isLoading}
            layout={params.layout}
          />
        )}
        {more > 0 && (
          <Link to={url} className="block pt-3 pb-1 text-2xs text-accent hover:underline" data-testid="portal-panel-more">
            {formatCountCompact(more)} more in the full view
          </Link>
        )}
      </div>
    </section>
  );
}
