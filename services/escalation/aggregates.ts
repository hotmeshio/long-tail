// ---------------------------------------------------------------------------
// Escalation analytics service — grouped/temporal reads over the interval
// time-series (see aggregate-sql.ts for the SQL semantics). Pure read surface:
// no lifecycle change, no write path.
//
// Caching splits by anchor. A now-anchored result (membership now, a window
// reaching now) is pace-board-grade: short TTL, cleared by
// invalidateEscalationAggregates() on every escalation write on this
// container. A fully-past anchor is immutable under every long-tail write
// path — created_at is set at insert and terminal transitions stamp NOW(),
// which is strictly after any past anchor — so those entries survive
// invalidation and live on the longer TTL (bounding the documented SDK
// post-terminal-touch caveat rather than caching forever). Keys canonicalize
// the whole input, so both caches are LRU-bounded.
// ---------------------------------------------------------------------------

import { getPool } from '../../lib/db';
import { config } from '../../modules/config';
import { ensureFacetReady } from './facets';
import { BoundedTtlCache } from './metrics-cache';
import {
  AnalyticsInputError,
  buildAggregateQuery,
  buildTimelineQuery,
  type BuiltAggregateQuery,
  type BuiltTimelineQuery,
  type StateSources,
} from './aggregate-sql';
import { requireFacetKey } from './aggregate-validate';
import type {
  AggregateByFacetsInput,
  AggregateByFacetsResult,
  AggregateRow,
  AnalyticsQuery,
  StateMatch,
  TimelineByFacetInput,
  TimelineByFacetResult,
  TimelineInterval,
} from '../../types';

const nowAnchoredCache = new BoundedTtlCache<AggregateByFacetsResult | TimelineByFacetResult>(
  config.LT_ANALYTICS_CACHE_TTL_MS,
  config.LT_ANALYTICS_CACHE_MAX_ENTRIES,
);
const pastAnchoredCache = new BoundedTtlCache<AggregateByFacetsResult | TimelineByFacetResult>(
  config.LT_ANALYTICS_PAST_CACHE_TTL_MS,
  config.LT_ANALYTICS_CACHE_MAX_ENTRIES,
);

/** Key-order-independent stringify, so `{a,b}` and `{b,a}` share one entry. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** Called on every escalation write (via invalidateEscalationAggregates). */
export function clearNowAnchoredAnalyticsCache(): void {
  nowAnchoredCache.clear();
}

/** Test hook: drop BOTH analytics caches. */
export function resetAnalyticsCaches(): void {
  nowAnchoredCache.clear();
  pastAnchoredCache.clear();
}

function matchesState(row: AggregateRow, m: StateMatch): boolean {
  if (m.role !== undefined && row.role !== m.role) return false;
  if (m.roles !== undefined && !m.roles.includes(row.role as string)) return false;
  if (m.subtype !== undefined && row.subtype !== m.subtype) return false;
  for (const [key, value] of Object.entries(m.facets ?? {})) {
    if (row.facets[key] == null || row.facets[key] !== String(value)) return false;
  }
  for (const key of m.exists ?? []) {
    if (row.facets[key] == null) return false;
  }
  return true;
}

function toAggregateRow(
  raw: Record<string, any>,
  built: BuiltAggregateQuery,
  states: AggregateByFacetsInput['states'],
): AggregateRow {
  const facets: Record<string, string | null> = {};
  for (const key of built.facets) facets[key] = raw[`facet_${key}`] ?? null;
  const row: AggregateRow = { facets, sampleCount: Number(raw.sample_count) };
  for (const column of built.columns) (row as any)[column] = raw[column] ?? undefined;
  if (built.measureKind === 'membership') row.count = Number(raw.count);
  else row.dwellSeconds = Number(raw.dwell_seconds);
  if (built.stateGrouped) {
    row.state = raw.state_label;
  } else {
    const label = (states ?? []).find((s) => matchesState(row, s.match));
    if (label) row.state = label.name;
  }
  return row;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toTimelineInterval(raw: Record<string, any>, built: BuiltTimelineQuery): TimelineInterval {
  const facets: Record<string, string | null> = {};
  for (const key of built.facets) facets[key] = raw[`facet_${key}`] ?? null;
  const interval: TimelineInterval = {
    role: raw.role,
    facets,
    startedAt: toIso(raw.started_at),
    endedAt: raw.ended_at == null ? null : toIso(raw.ended_at),
    durationSeconds: Number(raw.duration_seconds),
  };
  if (built.columns.includes('subtype')) interval.subtype = raw.subtype ?? undefined;
  if (built.columns.includes('status')) interval.status = raw.status;
  return interval;
}

// ── Entity-system resolution ─────────────────────────────────────────────────

const ENTITY_SYSTEM_SQL = `
  SELECT role, entity_state_source FROM lt_roles WHERE entity_facet = $1 ORDER BY role`;

const STATE_SOURCES_SQL = `
  SELECT role, entity_state_source FROM lt_roles WHERE role = ANY($1::text[])`;

/**
 * The roles declaring `entity_facet = key` — the entity's SYSTEM — with each
 * role's state naming. Loud when nothing declares the key: an empty system is
 * a config gap, not an empty result.
 */
export async function resolveEntitySystem(
  entityKey: string,
): Promise<Array<{ role: string; source: 'role' | 'subtype' }>> {
  requireFacetKey(entityKey, 'query.entity');
  await ensureFacetReady();
  const { rows } = await getPool().query(ENTITY_SYSTEM_SQL, [entityKey]);
  if (rows.length === 0) {
    throw new AnalyticsInputError(
      `no roles declare entity_facet "${entityKey}" — set Entity on the roles this entity moves through`,
    );
  }
  return rows.map((r: any) => ({
    role: r.role,
    source: r.entity_state_source === 'subtype' ? 'subtype' : 'role',
  }));
}

/** State naming for an explicit role list (roles missing from lt_roles default to 'role'). */
async function stateSourcesFor(roles: string[]): Promise<StateSources> {
  const { rows } = await getPool().query(STATE_SOURCES_SQL, [roles]);
  const sources: StateSources = {};
  for (const role of roles) sources[role] = 'role';
  for (const r of rows) sources[r.role] = r.entity_state_source === 'subtype' ? 'subtype' : 'role';
  return sources;
}

/**
 * Resolve `query.entity` (and `groupBy.state`) into concrete scope: the
 * system's roles replace `entity` on the filter (plus `exists: [entityKey]`
 * so rows without the entity stay out), and per-role state sources ride along
 * for the builder. The resolved system joins the cache key, so a role-config
 * edit changes the key rather than serving a stale state shape.
 */
async function resolveScope(
  query: AnalyticsQuery,
  needsStateSources: boolean,
): Promise<{ query: AnalyticsQuery; stateSources?: StateSources; cacheSuffix: string }> {
  if (query.entity !== undefined) {
    const system = await resolveEntitySystem(query.entity);
    const { entity, ...rest } = query;
    const resolved: AnalyticsQuery = {
      ...rest,
      roles: system.map((s) => s.role),
      exists: [...new Set([...(rest.exists ?? []), entity as string])],
    };
    const sources: StateSources = {};
    for (const s of system) sources[s.role] = s.source;
    return { query: resolved, stateSources: sources, cacheSuffix: `:${canonical(system)}` };
  }
  if (needsStateSources) {
    const roles = query.role ? [query.role] : query.roles ?? [];
    if (roles.length === 0) return { query, cacheSuffix: '' }; // builder rejects loudly
    const sources = await stateSourcesFor(roles);
    return { query, stateSources: sources, cacheSuffix: `:${canonical(sources)}` };
  }
  return { query, cacheSuffix: '' };
}

/**
 * Grouped aggregate over the escalation intervals — membership at an instant
 * or dwell over a window, grouped by columns + facets (+ the derived state
 * label). One call replaces N countByFacets round-trips.
 */
export async function aggregateByFacets(
  input: AggregateByFacetsInput,
): Promise<AggregateByFacetsResult> {
  const scope = await resolveScope(input.query ?? {}, input.groupBy?.state === true);
  const effective = { ...input, query: scope.query };
  // Validates loudly BEFORE any cache entry.
  const built = buildAggregateQuery(effective, { stateSources: scope.stateSources });
  const cache = built.nowAnchored ? nowAnchoredCache : pastAnchoredCache;
  return (await cache.resolve(`agg:${canonical(input)}${scope.cacheSuffix}`, async () => {
    await ensureFacetReady();
    const { rows } = await getPool().query(built.sql, built.params);
    return {
      groups: rows.slice(0, built.pageLimit).map((r: any) => toAggregateRow(r, built, input.states)),
      overflow: rows.length > built.pageLimit,
    };
  })) as AggregateByFacetsResult;
}

/**
 * One entity's ordered interval sequence — `[created_at, ended_at)` spans with
 * durations. Gaps between consecutive intervals are untracked time and are
 * deliberately preserved, not filled.
 */
export async function timelineByFacet(
  input: TimelineByFacetInput,
): Promise<TimelineByFacetResult> {
  const scope = await resolveScope(input.query ?? {}, false);
  const effective = { ...input, query: scope.query };
  const built = buildTimelineQuery(effective);
  const cache = built.nowAnchored ? nowAnchoredCache : pastAnchoredCache;
  return (await cache.resolve(`tl:${canonical(input)}${scope.cacheSuffix}`, async () => {
    await ensureFacetReady();
    const { rows } = await getPool().query(built.sql, built.params);
    return {
      intervals: rows.slice(0, built.pageLimit).map((r: any) => toTimelineInterval(r, built)),
      overflow: rows.length > built.pageLimit,
    };
  })) as TimelineByFacetResult;
}
