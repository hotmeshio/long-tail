import type { Types } from '@hotmeshio/hotmesh';

import { getPool } from '../../lib/db';
import type { LTEscalationRecord, LTEscalationStatus } from '../../types';

import { escalations, ensureEscalationCompatView } from './client';
import { toEscalationRecords } from './map';
import { buildFacetWhere, buildFacetOrder } from './facet-sql';
import type { EscalationStats, StationMetric } from './types';
import { SORTABLE_COLUMNS, VALID_PERIODS } from './types';
import { searchEscalationsQuery, COUNT_SEARCH_ESCALATIONS, STATION_LIVE_COUNTS_SQL, STATION_PERIOD_METRICS_SQL } from './sql';
import { TtlCache } from './metrics-cache';
import type { FacetQuery } from '../../types';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id arm of the correlation search binds a uuid param only when the term
 * parses as one — comparing `id::text = $term` casts the uuid column and has
 * no index path, which drags the whole OR into a full history scan.
 */
const asUuidOrNull = (term: string | null | undefined): string | null =>
  term && UUID_RE.test(term) ? term : null;

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
    asUuidOrNull(params.search),
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

/**
 * Scoped faceted search — the HUMAN operations query. Composes the read-scope
 * predicate (global → none; else `role ∈ allRoles OR (role ∈ selfRoles AND
 * assigned_to = me)`) with the full FacetQuery language (`buildFacetWhere`:
 * facets `@>`, block, numeric range, exists, status, available) plus the extra
 * top-level filters (type/subtype/priority/assigned_to) and an exact correlation-id
 * match (id/workflow_id/origin_id), then orders
 * by `buildFacetOrder` (columns + `metadata.<key>`). Every value is bound; the
 * COUNT shares the WHERE so totals stay correct across pages — no client-side
 * filtering. Reads go through the `public.lt_escalations` view.
 */
export async function searchEscalationsFaceted(opts: {
  global?: boolean;
  visibleRoles?: string[]; // read_all roles
  selfRoles?: string[];    // read_self roles
  meUserId?: string;
  facet: FacetQuery;       // role/roles/status/available/facets/block/range/exists/orderBy
  type?: string;
  subtype?: string;
  priority?: number;
  assigned_to?: string;
  search?: string;
  limit: number;
  offset: number;
}): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  await ensureEscalationCompatView();
  const pool = getPool();
  const params: unknown[] = [];
  const clauses: string[] = [];

  // 1. Read-scope predicate (skip entirely for global access).
  if (!opts.global) {
    const ai = params.push(opts.visibleRoles?.length ? opts.visibleRoles : null);
    const si = params.push(opts.selfRoles?.length ? opts.selfRoles : null);
    const mi = params.push(opts.meUserId || null);
    clauses.push(
      `(($${ai}::text[] IS NULL AND $${si}::text[] IS NULL)
        OR ($${ai}::text[] IS NOT NULL AND role = ANY($${ai}))
        OR ($${si}::text[] IS NOT NULL AND role = ANY($${si}) AND assigned_to = $${mi}))`,
    );
  }

  // 2. Faceted predicate (role/roles/status/available/facets/block/range/exists).
  const facetClause = buildFacetWhere(opts.facet, params);
  if (facetClause !== 'TRUE') clauses.push(facetClause);

  // 3. Extra top-level filters not expressed by FacetQuery.
  if (opts.type) clauses.push(`type = $${params.push(opts.type)}`);
  if (opts.subtype) clauses.push(`subtype = $${params.push(opts.subtype)}`);
  if (opts.priority != null) clauses.push(`priority = $${params.push(opts.priority)}`);
  if (opts.assigned_to) clauses.push(`assigned_to = $${params.push(opts.assigned_to)}`);

  // 4. Correlation-id match (exact) — same fields as the list search path.
  // Equality keeps it index-served (origin_id / workflow_id btree, id pk); the
  // id arm binds a pre-parsed uuid so the PK can serve it, and metadata is
  // searched precisely via the facets above, never a full-table text scan.
  if (opts.search) {
    const i = params.push(opts.search);
    const u = params.push(asUuidOrNull(opts.search));
    clauses.push(`(origin_id = $${i} OR workflow_id = $${i} OR ($${u}::uuid IS NOT NULL AND id = $${u}::uuid))`);
  }

  const where = clauses.length ? `WHERE ${clauses.join('\n  AND ')}` : '';
  const orderBy = buildFacetOrder(opts.facet.orderBy);
  const countParams = [...params];
  const li = params.push(opts.limit);
  const oi = params.push(opts.offset);

  const [rows, countRows] = await Promise.all([
    pool.query(
      `SELECT * FROM public.lt_escalations ${where} ORDER BY ${orderBy} LIMIT $${li} OFFSET $${oi}`,
      params,
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM public.lt_escalations ${where}`, countParams),
  ]);
  return { escalations: toEscalationRecords(rows.rows as any), total: countRows.rows[0]?.total ?? 0 };
}

/**
 * Distinct top-level metadata facet KEYS visible to the caller — feeds the faceted
 * UI's key autocomplete so it only ever offers facets that ACTUALLY exist in the
 * caller's rows (a key in metadata, not description text). Role-scoped with the same
 * predicate as the list; only object-typed metadata is unpacked (`jsonb_object_keys`).
 */
export async function listFacetKeys(opts: {
  global?: boolean;
  visibleRoles?: string[];
  selfRoles?: string[];
  meUserId?: string;
}): Promise<string[]> {
  await ensureEscalationCompatView();
  const pool = getPool();
  const params: unknown[] = [];
  const clauses: string[] = ["jsonb_typeof(metadata) = 'object'"];

  if (!opts.global) {
    const ai = params.push(opts.visibleRoles?.length ? opts.visibleRoles : null);
    const si = params.push(opts.selfRoles?.length ? opts.selfRoles : null);
    const mi = params.push(opts.meUserId || null);
    clauses.push(
      `(($${ai}::text[] IS NULL AND $${si}::text[] IS NULL)
        OR ($${ai}::text[] IS NOT NULL AND role = ANY($${ai}))
        OR ($${si}::text[] IS NOT NULL AND role = ANY($${si}) AND assigned_to = $${mi}))`,
    );
  }

  const { rows } = await pool.query(
    `SELECT DISTINCT jsonb_object_keys(metadata) AS key
       FROM public.lt_escalations
      WHERE ${clauses.join('\n        AND ')}
      ORDER BY key`,
    params,
  );
  const actualKeys = new Set(rows.map((r: any) => r.key as string));

  // Also surface keys declared in metadata_schema for visible roles — so the
  // autocomplete offers expected keys even before any data has been created.
  const roleFilter = opts.global
    ? null
    : [...(opts.visibleRoles ?? []), ...(opts.selfRoles ?? [])];

  if (roleFilter === null || roleFilter.length > 0) {
    const schemaParam = roleFilter === null ? null : roleFilter;
    const { rows: schemaRows } = await pool.query(
      `SELECT metadata_schema FROM lt_roles
        WHERE metadata_schema IS NOT NULL
          AND ($1::text[] IS NULL OR role = ANY($1))`,
      [schemaParam],
    );
    for (const row of schemaRows) {
      const schema = row.metadata_schema;
      if (schema?.properties && typeof schema.properties === 'object') {
        for (const key of Object.keys(schema.properties)) {
          actualKeys.add(key);
        }
      }
    }
  }

  return [...actualKeys].sort();
}

// Escalation stats back the home + overview surfaces and refresh on every
// escalation event. As of hotmesh 0.25.0 the SDK stats query reads three
// bounded, index-only sources (pending backlog, created window, resolved
// window), so it is cheap enough to run per-request — this short single-flight
// window exists purely to collapse the refetch burst a busy escalation stream
// triggers (every event → every open dashboard refetches at once). Local
// writes clear the cache (see crud.ts publishEscalationChange), so a refetch
// on this container always observes its own write.
const ESCALATION_STATS_CACHE_TTL_MS = 2_500;
const escalationStatsCache = new TtlCache<EscalationStats>(ESCALATION_STATS_CACHE_TTL_MS);

export async function getEscalationStats(
  visibleRoles?: string[],
  period?: string,
): Promise<EscalationStats> {
  const key = `${period ?? '24h'}::${visibleRoles ? [...visibleRoles].sort().join(',') : 'ALL'}`;
  return escalationStatsCache.resolve(key, async () => {
    const client = await escalations();
    return client.stats({
      roles: visibleRoles,
      period: period as '1h' | '24h' | '7d' | '30d' | undefined,
    });
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

// Period metrics (percentiles + throughput) are expensive and slow-changing, so
// they are cached ~30s and shared, via single-flight, across the socket-driven
// refresh burst and all concurrent viewers. Live counts are never cached — they
// refresh on every event. Per-container cache; 30-60s staleness is acceptable.
const STATION_PERIOD_CACHE_TTL_MS = 30_000;
const stationPeriodCache = new TtlCache<Record<string, unknown>[]>(STATION_PERIOD_CACHE_TTL_MS);

/**
 * Drop cached aggregates (period metrics + escalation stats). Called by the
 * write paths in crud.ts alongside each escalation event publish: the event
 * tells dashboards "data changed", so the very next fetch on this container
 * must recompute rather than serve the pre-change aggregate for up to a TTL.
 * Cross-container staleness within the TTL remains and is acceptable.
 */
export function invalidateEscalationAggregates(): void {
  stationPeriodCache.clear();
  escalationStatsCache.clear();
}

/** Test hook: drop cached period metrics AND escalation stats so tests observe fresh rows. */
export function resetStationMetricsCache(): void {
  invalidateEscalationAggregates();
}

const toNum = (v: unknown): number | null => (v != null ? Number(v) : null);

export async function getStationMetrics(
  visibleRoles: string[] | undefined,
  period?: string,
): Promise<StationMetric[]> {
  await ensureEscalationCompatView();
  // hasOwnProperty: a caller-supplied period like 'constructor' must fall back
  // to 24h, not resolve to an inherited Object.prototype member.
  const intervalStr = period && Object.prototype.hasOwnProperty.call(VALID_PERIODS, period)
    ? VALID_PERIODS[period]
    : '24 hours';
  const roles = visibleRoles ?? null;
  const pool = getPool();

  // Live counts: always fresh (cheap — bounded pending working set).
  // Period metrics: cached ~30s, single-flight (expensive percentile sort).
  const cacheKey = `${period ?? '24h'}::${roles ? [...roles].sort().join(',') : 'ALL'}`;
  const [countsResult, periodRows] = await Promise.all([
    pool.query(STATION_LIVE_COUNTS_SQL, [roles]),
    stationPeriodCache.resolve(
      cacheKey,
      async () => (await pool.query(STATION_PERIOD_METRICS_SQL, [roles, intervalStr])).rows,
    ),
  ]);

  const periodByRole = new Map<string, any>(periodRows.map((r: any) => [r.role, r]));

  return countsResult.rows.map((c: any): StationMetric => {
    const p = periodByRole.get(c.role);
    return {
      role: c.role,
      pending: Number(c.pending ?? 0),
      claimed: Number(c.claimed ?? 0),
      resolved: Number(p?.resolved ?? 0),
      priority_count: Number(c.priority_count ?? 0),
      throughput_pct: p?.throughput_pct != null ? Number(p.throughput_pct) : null,
      wait: {
        p99: toNum(p?.p99_wait_min),
        p50: toNum(p?.p50_wait_min),
        avg: toNum(p?.avg_wait_min),
        max: toNum(p?.max_wait_min),
      },
      work: {
        p99: toNum(p?.p99_work_min),
        p50: toNum(p?.p50_work_min),
        avg: toNum(p?.avg_work_min),
        max: toNum(p?.max_work_min),
      },
    };
  });
}
