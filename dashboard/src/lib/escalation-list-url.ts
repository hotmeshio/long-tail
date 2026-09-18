import type { FacetFilters } from '../api/escalations';
import type { LTEscalationStatus as EscalationStatus } from '../api/types/escalations';
import { parseFacetParams } from './facet-url';

/**
 * The escalations list URL, read once into the shape its queries take. The
 * list page reads the address bar; a pinned view or a portal panel reads a
 * saved URL. Both go through here, so a panel and the page it opens onto
 * always run the same query.
 */

export const LIST_VIEWS = {
  TABLE: 'table',
  RICH: 'rich',
  TIMELINE: 'timeline',
} as const;
export type ListView = (typeof LIST_VIEWS)[keyof typeof LIST_VIEWS];

/**
 * How a table view spends its width. `compact` never folds into cards and
 * keeps only identity columns until the container widens, so a narrow panel
 * shows a tight list that fits on a screen nobody scrolls. `cards` always
 * folds. Absent, the table folds below the card threshold on its own.
 */
export const LIST_LAYOUTS = {
  COMPACT: 'compact',
  CARDS: 'cards',
} as const;
export type ListLayout = (typeof LIST_LAYOUTS)[keyof typeof LIST_LAYOUTS];

export const LIST_PATHS = {
  AVAILABLE: '/escalations/available',
  ALL: '/escalations',
} as const;

/** The status vocabulary as the URL names it. */
export const LIST_STATUS = {
  AVAILABLE: 'available',
  CLAIMED: 'claimed',
  RESOLVED: 'resolved',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  ALL: 'all',
} as const;

export interface EscalationListParams {
  /** The status filter as the URL names it; empty means unset. */
  statusFilter: string;
  role?: string;
  type?: string;
  priority?: number;
  search?: string;
  facets: FacetFilters;
  /** The presentation the URL asks for; null leaves the choice to the surface. */
  view: ListView | null;
  /** How the presentation spends its width; null lets the table fold on its own. */
  layout: ListLayout | null;
}

/** Where the rows come from for a status filter: the available pool, or the plain list with its status and claimed flags. */
export interface ListRoute {
  available: boolean;
  claimed: boolean;
  apiStatus: EscalationStatus | undefined;
}

const TERMINAL: Record<string, EscalationStatus> = {
  [LIST_STATUS.RESOLVED]: 'resolved',
  [LIST_STATUS.CANCELLED]: 'cancelled',
  [LIST_STATUS.EXPIRED]: 'expired',
};

/**
 * `available` routes through the available-only query (pending, unclaimed).
 * `claimed` is the plain list at pending with the claimed flag. `all` and
 * unset send no status, so a facet search spans every status.
 */
export function resolveListRoute(statusFilter: string): ListRoute {
  const claimed = statusFilter === LIST_STATUS.CLAIMED;
  return {
    available: statusFilter === LIST_STATUS.AVAILABLE,
    claimed,
    apiStatus: claimed ? 'pending' : TERMINAL[statusFilter],
  };
}

export function isListView(value: string | null | undefined): value is ListView {
  return value === LIST_VIEWS.TABLE || value === LIST_VIEWS.RICH || value === LIST_VIEWS.TIMELINE;
}

export function isListLayout(value: string | null | undefined): value is ListLayout {
  return value === LIST_LAYOUTS.COMPACT || value === LIST_LAYOUTS.CARDS;
}

/** Read the list vocabulary from search params; `defaultStatus` stands in for an absent status. */
export function readEscalationListParams(sp: URLSearchParams, defaultStatus = ''): EscalationListParams {
  const priority = sp.get('priority');
  const view = sp.get('view');
  const layout = sp.get('layout');
  return {
    statusFilter: sp.get('status') || defaultStatus,
    role: sp.get('role') || undefined,
    type: sp.get('type') || undefined,
    priority: priority ? parseInt(priority, 10) : undefined,
    search: sp.get('search') || undefined,
    facets: parseFacetParams(sp),
    view: isListView(view) ? view : null,
    layout: isListLayout(layout) ? layout : null,
  };
}

/** A saved list URL (a pin) as list params, or null for any other URL. The available pool defaults to its own status. */
export function parseEscalationListUrl(url: string): EscalationListParams | null {
  let parsed: URL;
  try {
    parsed = new URL(url, 'http://local');
  } catch {
    return null;
  }
  if (parsed.pathname !== LIST_PATHS.AVAILABLE && parsed.pathname !== LIST_PATHS.ALL) return null;
  const defaultStatus = parsed.pathname === LIST_PATHS.AVAILABLE ? LIST_STATUS.AVAILABLE : '';
  return readEscalationListParams(parsed.searchParams, defaultStatus);
}

/** The role a list is scoped to when it names exactly one: the role param, or a lone roles[] facet. */
export function singleRoleOf(params: EscalationListParams): string | null {
  return params.role || (params.facets.roles?.length === 1 ? params.facets.roles[0] : null);
}

/**
 * The presentation to render. Timeline when asked. Rich when the role owns a
 * non-table list schema and the URL either asks for rich or leaves the choice
 * open. Table otherwise, so a rich pin degrades to the table when the schema
 * changes.
 */
export function resolveListView(view: ListView | null, hasRichView: boolean): ListView {
  if (view === LIST_VIEWS.TIMELINE) return LIST_VIEWS.TIMELINE;
  if (hasRichView && (view ? view === LIST_VIEWS.RICH : true)) return LIST_VIEWS.RICH;
  return LIST_VIEWS.TABLE;
}
