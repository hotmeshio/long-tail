// ---------------------------------------------------------------------------
// Analytics input validation — every constraint checked loudly up front so the
// SQL builders (aggregate-sql.ts) compose only proven-safe pieces. Unlike the
// legacy row paths (buildFacetWhere silently drops malformed range/exists
// entries), the analytics surface rejects: a filter the caller believes is
// applied but isn't would silently change what an aggregate MEANS.
// ---------------------------------------------------------------------------

import { config } from '../../modules/config';
import { FACET_KEY } from './facet-sql';
import { GROUPABLE_COLUMNS } from '../../types';
import type {
  AnalyticsWindow,
  FacetGroupBy,
  FacetQuery,
  GroupableColumn,
  StateMatch,
} from '../../types';

/** A caller-input problem — mapped to HTTP 400 by the api layer. */
export class AnalyticsInputError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsInputError';
  }
}

const VALID_STATUSES = new Set(['pending', 'resolved', 'cancelled', 'expired']);
const RANGE_OPS = new Set(['<', '<=', '>', '>=', '=']);
/** Clock-skew tolerance when rejecting a future asOf. */
const FUTURE_SKEW_MS = 5_000;
/** anyOf targets an explicit entity set (a table page) — never an unbounded list. */
const MAX_ANY_OF = 200;

export function requireFacetKey(key: string, label: string): string {
  if (typeof key !== 'string' || !FACET_KEY.test(key)) {
    throw new AnalyticsInputError(
      `${label} "${key}" is not a valid facet key (letters, digits, underscore only)`,
    );
  }
  return key;
}

/**
 * The statuses the caller considers live, validated against the closed status
 * set. Values are later inlined as SQL literals, so this whitelist is also the
 * injection boundary.
 */
export function resolveLiveStatuses(liveStatuses?: string[]): string[] {
  const list = liveStatuses ?? ['pending'];
  if (!Array.isArray(list) || list.length === 0) {
    throw new AnalyticsInputError('liveStatuses must be a non-empty array when provided');
  }
  const out: string[] = [];
  for (const s of list) {
    if (!VALID_STATUSES.has(s)) {
      throw new AnalyticsInputError(
        `liveStatuses contains unknown status "${s}" (valid: ${[...VALID_STATUSES].join(', ')})`,
      );
    }
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * The analytics filter accepts the WHAT of a FacetQuery (role/roles or entity,
 * facets, block, range, exists) and rejects everything that describes liveness
 * or row paging — those are derived from the measure and the group page
 * instead. `entity` is validated here and RESOLVED by the service (to the
 * roles declaring it) before any SQL is built.
 */
export function requireCleanFilter(
  query: (FacetQuery & { entity?: string }) | undefined,
  label = 'query',
): FacetQuery & { entity?: string } {
  const q: any = query ?? {};
  if (q.entity !== undefined) {
    requireFacetKey(q.entity, `${label}.entity`);
    if (q.role !== undefined || q.roles !== undefined) {
      throw new AnalyticsInputError(
        `${label}.entity and ${label}.role/roles are two scoping mechanisms — use one: entity derives the roles from their entity_facet declarations`,
      );
    }
  }
  for (const field of ['status', 'available', 'jeopardy']) {
    if (q[field] !== undefined) {
      throw new AnalyticsInputError(
        `${label}.${field} is not accepted in analytics — liveness derives from the interval; use liveStatuses and the measure anchor`,
      );
    }
  }
  for (const field of ['orderBy', 'limit', 'offset']) {
    if (q[field] !== undefined) {
      throw new AnalyticsInputError(
        `${label}.${field} is not accepted in analytics — order and paginate the result groups with the top-level orderBy/limit/offset`,
      );
    }
  }
  for (const r of q.range ?? []) {
    requireFacetKey(r?.facet, `${label}.range facet`);
    if (!RANGE_OPS.has(r?.op)) {
      throw new AnalyticsInputError(`${label}.range op "${r?.op}" is not one of < <= > >= =`);
    }
  }
  for (const key of q.exists ?? []) {
    requireFacetKey(key, `${label}.exists key`);
  }
  for (const [key, value] of Object.entries(q.prefix ?? {})) {
    requireFacetKey(key, `${label}.prefix key`);
    if (typeof value !== 'string' || value.length === 0) {
      throw new AnalyticsInputError(`${label}.prefix["${key}"] must be a non-empty string`);
    }
  }
  for (const [key, value] of Object.entries(q.equals ?? {})) {
    requireFacetKey(key, `${label}.equals key`);
    if (typeof value !== 'string' || value.length === 0) {
      throw new AnalyticsInputError(`${label}.equals["${key}"] must be a non-empty string`);
    }
  }
  if (q.anyOf !== undefined) {
    if (!Array.isArray(q.anyOf) || q.anyOf.length === 0) {
      throw new AnalyticsInputError(`${label}.anyOf must be a non-empty array of facet sets`);
    }
    if (q.anyOf.length > MAX_ANY_OF) {
      throw new AnalyticsInputError(`${label}.anyOf holds ${q.anyOf.length} entries; the maximum is ${MAX_ANY_OF} — page the target set`);
    }
    for (const entry of q.anyOf) {
      if (!entry || typeof entry !== 'object' || Object.keys(entry).length === 0) {
        throw new AnalyticsInputError(`${label}.anyOf entries must be non-empty facet objects`);
      }
      for (const key of Object.keys(entry)) requireFacetKey(key, `${label}.anyOf key`);
    }
  }
  return q;
}

/** Timeline paging direction; `before` is a strict created_at upper bound. */
export function resolveTimelinePage(
  order: 'asc' | 'desc' | undefined,
  before: Date | string | undefined,
): { order: 'asc' | 'desc'; before: Date | null } {
  if (order !== undefined && order !== 'asc' && order !== 'desc') {
    throw new AnalyticsInputError('order must be "asc" or "desc"');
  }
  return {
    order: order ?? 'asc',
    before: before === undefined ? null : toInstant(before, 'before'),
  };
}

export function toInstant(value: Date | string, label: string): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AnalyticsInputError(`${label} is not a parseable instant: "${value}"`);
  }
  return d;
}

/** Half-open [from, to): ordered, and bounded by LT_ANALYTICS_MAX_WINDOW_DAYS. */
export function resolveWindow(
  window: AnalyticsWindow | undefined,
  label = 'window',
): { from: Date; to: Date; nowAnchored: boolean } | null {
  if (!window) return null;
  const from = toInstant(window.from, `${label}.from`);
  const to = toInstant(window.to, `${label}.to`);
  if (from.getTime() >= to.getTime()) {
    throw new AnalyticsInputError(`${label} is empty: from must be before to`);
  }
  const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (spanDays > config.LT_ANALYTICS_MAX_WINDOW_DAYS) {
    throw new AnalyticsInputError(
      `${label} spans ${spanDays.toFixed(1)} days; the maximum is ${config.LT_ANALYTICS_MAX_WINDOW_DAYS} (LT_ANALYTICS_MAX_WINDOW_DAYS)`,
    );
  }
  return { from, to, nowAnchored: to.getTime() >= Date.now() };
}

/** Membership anchor: null = now (the cheap live-set path); a past instant otherwise. */
export function resolveAsOf(asOf: Date | string | undefined): Date | null {
  if (asOf === undefined) return null;
  const d = toInstant(asOf, 'measure.asOf');
  if (d.getTime() > Date.now() + FUTURE_SKEW_MS) {
    throw new AnalyticsInputError(
      'measure.asOf is in the future — membership can only be reconstructed for past instants',
    );
  }
  return d;
}

export function resolveGroupBy(groupBy: FacetGroupBy | undefined): {
  columns: GroupableColumn[];
  facets: string[];
  state: boolean;
} {
  const columns: GroupableColumn[] = [];
  for (const c of groupBy?.columns ?? []) {
    if (!GROUPABLE_COLUMNS.includes(c)) {
      throw new AnalyticsInputError(
        `groupBy.columns contains "${c}" (valid: ${GROUPABLE_COLUMNS.join(', ')})`,
      );
    }
    if (!columns.includes(c)) columns.push(c);
  }
  const facets: string[] = [];
  for (const key of groupBy?.facets ?? []) {
    requireFacetKey(key, 'groupBy.facets key');
    if (!facets.includes(key)) facets.push(key);
  }
  return { columns, facets, state: groupBy?.state === true };
}

/**
 * A state label that references a group key the query never produces can never
 * match — that is a caller bug, so it throws rather than silently never labeling.
 */
export function validateStates(
  states: Array<{ name: string; match: StateMatch }> | undefined,
  columns: GroupableColumn[],
  facets: string[],
): void {
  for (const s of states ?? []) {
    if (!s?.name) throw new AnalyticsInputError('states entries require a name');
    const m = s.match ?? {};
    if ((m.role !== undefined || m.roles !== undefined) && !columns.includes('role')) {
      throw new AnalyticsInputError(
        `state "${s.name}" matches on role, but groupBy.columns does not include "role"`,
      );
    }
    if (m.subtype !== undefined && !columns.includes('subtype')) {
      throw new AnalyticsInputError(
        `state "${s.name}" matches on subtype, but groupBy.columns does not include "subtype"`,
      );
    }
    for (const key of Object.keys(m.facets ?? {})) {
      if (!facets.includes(key)) {
        throw new AnalyticsInputError(
          `state "${s.name}" matches on facet "${key}", but groupBy.facets does not include it`,
        );
      }
    }
    for (const key of m.exists ?? []) {
      if (!facets.includes(key)) {
        throw new AnalyticsInputError(
          `state "${s.name}" requires facet "${key}", but groupBy.facets does not include it`,
        );
      }
    }
  }
}

/** Result-group paging, hard-capped at LT_ANALYTICS_MAX_GROUPS. */
export function resolvePage(
  limit?: number,
  offset?: number,
): { pageLimit: number; offset: number } {
  const cap = config.LT_ANALYTICS_MAX_GROUPS;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new AnalyticsInputError('limit must be a positive integer');
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new AnalyticsInputError('offset must be a non-negative integer');
  }
  return { pageLimit: Math.min(limit ?? cap, cap), offset: offset ?? 0 };
}
