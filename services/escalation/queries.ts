import type { Types } from '@hotmeshio/hotmesh';

import { getPool } from '../../lib/db';
import type { LTEscalationRecord, LTEscalationStatus } from '../../types';

import { escalations, ensureEscalationCompatView } from './client';
import { toEscalationRecords } from './map';
import type { EscalationStats } from './types';
import { SORTABLE_COLUMNS } from './types';
import { searchEscalationsQuery, COUNT_SEARCH_ESCALATIONS } from './sql';

type SdkListParams = Types.ListEscalationsParams;
type OrderBy = NonNullable<SdkListParams['orderBy']>;

/**
 * Default sort is priority ASC, created_at ASC. A user-chosen `sort_by` maps to
 * a single column (DESC unless `order='asc'`), matching the legacy behavior.
 */
function buildOrderBy(sortBy?: string, order?: string): OrderBy {
  if (sortBy && SORTABLE_COLUMNS.has(sortBy)) {
    return [{ column: sortBy as OrderBy[number]['column'], direction: order === 'asc' ? 'asc' : 'desc' }];
  }
  return [
    { column: 'priority', direction: 'asc' },
    { column: 'created_at', direction: 'asc' },
  ];
}

/**
 * ORDER BY clause for the raw search query. `sortBy` is checked against the
 * SORTABLE_COLUMNS whitelist before interpolation, so it is injection-safe.
 */
function buildSearchOrderBy(sortBy?: string, order?: string): string {
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  if (sortBy && SORTABLE_COLUMNS.has(sortBy)) {
    return `${sortBy} ${dir}`;
  }
  return 'priority ASC, created_at ASC';
}

/**
 * Server-side free-text search over the `lt_escalations` view. Runs when a
 * caller supplies a non-empty `search` term — the SDK `client.list()` cannot do
 * free-text, so this is raw SQL on the shared table (see ./sql.ts). All other
 * filters combine with the term (AND).
 */
async function searchEscalations(params: {
  status?: LTEscalationStatus;
  role?: string;
  roles?: string[];
  selfRoles?: string[];
  meUserId?: string;
  type?: string;
  subtype?: string;
  priority?: number;
  assigned_to?: string;
  available?: boolean;
  search?: string;
  metadata?: Record<string, any>;
  limit: number;
  offset: number;
  sort_by?: string;
  order?: string;
}): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  await ensureEscalationCompatView();
  const pool = getPool();
  // Coerce empty strings to NULL so an absent filter (e.g. assigned_to='') does
  // not become `column = ''` and match zero rows. Mirrors the SDK path's
  // `if (filters.x)` truthiness guards. An empty search term means "no free-text
  // filter" — this path also serves scoped (self-role) listing with no search.
  const filterArgs = [
    params.status || null,
    params.role || null,
    params.roles && params.roles.length ? params.roles : null,
    params.type || null,
    params.subtype || null,
    params.priority ?? null,
    params.assigned_to || null,
    params.available ?? null,
    params.search || null,
    params.selfRoles && params.selfRoles.length ? params.selfRoles : null,
    params.meUserId || null,
    params.metadata ? JSON.stringify(params.metadata) : null,
  ];
  const orderBy = buildSearchOrderBy(params.sort_by, params.order);
  const [rows, countRows] = await Promise.all([
    pool.query(searchEscalationsQuery(orderBy), [...filterArgs, params.limit, params.offset]),
    pool.query(COUNT_SEARCH_ESCALATIONS, filterArgs),
  ]);
  return {
    escalations: toEscalationRecords(rows.rows as any),
    total: countRows.rows[0]?.total ?? 0,
  };
}

export async function getEscalationStats(
  visibleRoles?: string[],
  period?: string,
): Promise<EscalationStats> {
  const client = await escalations();
  return client.stats({
    roles: visibleRoles,
    period: period as '1h' | '24h' | '7d' | '30d' | undefined,
  });
}

export async function listDistinctTypes(): Promise<string[]> {
  const client = await escalations();
  return client.listDistinctTypes();
}

export async function listEscalations(filters: {
  status?: LTEscalationStatus;
  role?: string;
  type?: string;
  subtype?: string;
  assigned_to?: string;
  claimed?: boolean;
  priority?: number;
  limit?: number;
  offset?: number;
  visibleRoles?: string[];
  selfRoles?: string[];
  meUserId?: string;
  sort_by?: string;
  order?: string;
  search?: string;
  metadata?: Record<string, any>;
}): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  // Active claim semantics: assigned_to-active and `claimed` both mean "held now".
  const heldNow = !!(filters.assigned_to || filters.claimed);
  const hasSelfScope = !!(filters.selfRoles && filters.selfRoles.length);

  // Free-text search OR read_self scoping → server-side SQL path. The SDK list()
  // has no free-text and cannot express the (role ∈ selfRoles AND assigned_to=me)
  // self-scope branch, so both route through the raw-SQL search query (which also
  // serves metadata-containment for findByMetadata's self-scope callers).
  if (filters.search || hasSelfScope) {
    return searchEscalations({
      status: filters.status,
      role: filters.role,
      roles: filters.visibleRoles,
      selfRoles: filters.selfRoles,
      meUserId: filters.meUserId,
      type: filters.type,
      subtype: filters.subtype,
      priority: filters.priority,
      assigned_to: filters.assigned_to,
      available: heldNow ? false : undefined,
      search: filters.search,
      metadata: filters.metadata,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
      sort_by: filters.sort_by,
      order: filters.order,
    });
  }

  const client = await escalations();

  // Shared filter — passed to both list() and count() so totals stay in sync.
  const where: SdkListParams = {
    status: filters.status,
    role: filters.role,
    type: filters.type,
    subtype: filters.subtype,
    priority: filters.priority,
    roles: filters.visibleRoles,
  };
  if (filters.assigned_to) where.assignedTo = filters.assigned_to;
  if (heldNow) where.available = false;
  if (filters.metadata) where.metadata = filters.metadata;

  const [rows, total] = await Promise.all([
    client.list({
      ...where,
      orderBy: buildOrderBy(filters.sort_by, filters.order),
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    }),
    client.count(where),
  ]);

  return { escalations: toEscalationRecords(rows), total };
}

/**
 * List available escalations: pending AND (unassigned OR expired claim).
 */
export async function listAvailableEscalations(filters: {
  role?: string;
  type?: string;
  subtype?: string;
  priority?: number;
  limit?: number;
  offset?: number;
  visibleRoles?: string[];
  selfRoles?: string[];
  meUserId?: string;
  sort_by?: string;
  order?: string;
  search?: string;
}): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  const hasSelfScope = !!(filters.selfRoles && filters.selfRoles.length);

  // Free-text search OR read_self scoping → server-side SQL path
  // (available = pending + no active claim).
  if (filters.search || hasSelfScope) {
    return searchEscalations({
      status: 'pending',
      role: filters.role,
      roles: filters.visibleRoles,
      selfRoles: filters.selfRoles,
      meUserId: filters.meUserId,
      type: filters.type,
      subtype: filters.subtype,
      priority: filters.priority,
      available: true,
      search: filters.search,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
      sort_by: filters.sort_by,
      order: filters.order,
    });
  }

  const client = await escalations();

  const where: SdkListParams = {
    status: 'pending',
    available: true,
    role: filters.role,
    type: filters.type,
    subtype: filters.subtype,
    priority: filters.priority,
    roles: filters.visibleRoles,
  };

  const [rows, total] = await Promise.all([
    client.list({
      ...where,
      orderBy: buildOrderBy(filters.sort_by, filters.order),
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    }),
    client.count(where),
  ]);

  return { escalations: toEscalationRecords(rows), total };
}
