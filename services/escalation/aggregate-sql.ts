// ---------------------------------------------------------------------------
// Analytics SQL — grouped/temporal builders over the escalation queue. Every
// escalation is one open interval [created_at, ended_at): ended_at is the
// instant the row left the live set (COALESCE(resolved_at, updated_at) for
// terminal rows — resolve stamps resolved_at, cancel/expire stamp updated_at
// in the same guarded transition). The three read modes are projections of
// that interval: membership at an instant, dwell over a window, and the
// per-entity timeline.
//
// Composition rules, same as facet-sql.ts: every value is parameterized;
// only validated column names / facet keys and the closed status whitelist
// are interpolated. Statuses inline as literals (never parameters) so the
// planner can prove the idx_hmsh_esc_ended_at partial predicate
// (status <> 'pending') from `status NOT IN ('pending', ...)`, and the
// terminal-interval branch is written explicitly (not COALESCE-folded) so it
// can BitmapOr with the pending stats index instead of scanning history.
// ---------------------------------------------------------------------------

import { buildFacetWhere } from './facet-sql';
import {
  AnalyticsInputError,
  requireCleanFilter,
  requireFacetKey,
  resolveAsOf,
  resolveGroupBy,
  resolveLiveStatuses,
  resolvePage,
  resolveTimelinePage,
  resolveWindow,
  validateStates,
} from './aggregate-validate';
import { GROUPABLE_COLUMNS } from '../../types';
import type {
  AggregateByFacetsInput,
  AggregateOrder,
  GroupableColumn,
  TimelineByFacetInput,
} from '../../types';

export { AnalyticsInputError } from './aggregate-validate';

export interface BuiltAggregateQuery {
  sql: string;
  params: unknown[];
  /** Groups per page; the SQL fetches pageLimit + 1 rows to detect overflow. */
  pageLimit: number;
  columns: GroupableColumn[];
  facets: string[];
  /** true when grouped by the derived state label (groupBy.state). */
  stateGrouped: boolean;
  measureKind: 'membership' | 'dwell';
  /** true = the anchor touches now (short cache); false = fully past (immutable). */
  nowAnchored: boolean;
}

/** Per-role state naming, from lt_roles.entity_state_source. */
export type StateSources = Record<string, 'role' | 'subtype'>;

export interface BuiltTimelineQuery {
  sql: string;
  params: unknown[];
  pageLimit: number;
  columns: GroupableColumn[];
  facets: string[];
  nowAnchored: boolean;
}

/** SQL string literal — values come from our own lt_roles rows, escaped anyway. */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The derived state label: roles sourcing states from their subtypes
 * contribute COALESCE(subtype, role); everyone else IS their state.
 */
function stateExpr(sources: StateSources): string {
  const subtypeRoles = Object.keys(sources).filter((r) => sources[r] === 'subtype').sort();
  if (subtypeRoles.length === 0) return 'role';
  return `CASE WHEN role IN (${subtypeRoles.map(sqlLiteral).join(', ')}) THEN COALESCE(subtype, role) ELSE role END`;
}

/** Validated statuses as an inline literal list, e.g. `'pending', 'resolved'`. */
function statusLiterals(statuses: string[]): string {
  return statuses.map((s) => `'${s}'`).join(', ');
}

/** The projected-facet output alias; the key is FACET_KEY-validated. */
function facetAlias(key: string): string {
  return `"facet_${key}"`;
}

/** The instant a row left the live set; NULL while live. */
function endedAtExpr(liveList: string): string {
  return `CASE WHEN status NOT IN (${liveList}) THEN COALESCE(resolved_at, updated_at) END`;
}

/**
 * Interval-overlap predicate: the row was open at some point after `fromParam`
 * (live rows are open now; terminal rows ended after it). Branch-explicit so
 * each side has an index (stats_pending / ended_at partial).
 */
function overlapsAfter(liveList: string, fromParam: string): string {
  return `(status IN (${liveList}) OR (status NOT IN (${liveList}) AND COALESCE(resolved_at, updated_at) > ${fromParam}))`;
}

/** ORDER BY over the RESULT groups: measure aliases and grouped keys only. */
function buildAggregateOrder(
  orderBy: AggregateOrder[] | undefined,
  measureKind: 'membership' | 'dwell',
  columns: GroupableColumn[],
  facets: string[],
  stateGrouped = false,
): string {
  if (!orderBy || !orderBy.length) return 'sample_count DESC';
  const parts: string[] = [];
  for (const o of orderBy) {
    const dir = o.direction === 'desc' ? 'DESC' : 'ASC';
    if (o.field === 'state' && stateGrouped) {
      parts.push(`state_label ${dir}`);
    } else if (o.field === 'count') {
      if (measureKind !== 'membership') {
        throw new AnalyticsInputError('orderBy "count" applies to membership; use "dwellSeconds" for dwell');
      }
      parts.push(`"count" ${dir}`);
    } else if (o.field === 'dwellSeconds') {
      if (measureKind !== 'dwell') {
        throw new AnalyticsInputError('orderBy "dwellSeconds" applies to dwell; use "count" for membership');
      }
      parts.push(`dwell_seconds ${dir}`);
    } else if (o.field === 'sampleCount') {
      parts.push(`sample_count ${dir}`);
    } else if (columns.includes(o.field as GroupableColumn)) {
      parts.push(`${o.field} ${dir}`);
    } else if (facets.includes(o.field)) {
      parts.push(`${facetAlias(o.field)} ${dir} NULLS LAST`);
    } else {
      throw new AnalyticsInputError(
        `orderBy field "${o.field}" is not a measure (count, dwellSeconds, sampleCount) or a grouped key`,
      );
    }
  }
  return parts.join(', ');
}

/**
 * Build the grouped aggregate (membership or dwell) as one parameterized
 * query. `query.entity` must be RESOLVED by the caller before building
 * (aggregates.ts turns it into roles + opts.stateSources); the builder
 * rejects an unresolved entity so it can never be silently ignored.
 */
export function buildAggregateQuery(
  input: AggregateByFacetsInput,
  opts: { stateSources?: StateSources } = {},
): BuiltAggregateQuery {
  const query = requireCleanFilter(input.query);
  if (query.entity !== undefined) {
    throw new AnalyticsInputError('query.entity must be resolved to roles before building SQL');
  }
  const { columns, facets, state } = resolveGroupBy(input.groupBy);
  if (state && input.states !== undefined) {
    throw new AnalyticsInputError(
      'groupBy.state and states[] are two labeling mechanisms — use one: state derives labels from the roles\' entity_state_source',
    );
  }
  if (state && !opts.stateSources) {
    throw new AnalyticsInputError(
      'groupBy.state requires a role scope — set query.entity (the derived system) or query.role/roles',
    );
  }
  validateStates(input.states, columns, facets);
  const live = resolveLiveStatuses(input.liveStatuses);
  const liveList = statusLiterals(live);
  const { pageLimit, offset } = resolvePage(input.limit, input.offset);

  const measure = input.measure;
  if (measure?.kind !== 'membership' && measure?.kind !== 'dwell') {
    throw new AnalyticsInputError('measure.kind must be "membership" or "dwell"');
  }

  const params: unknown[] = [];
  const where = buildFacetWhere(query, params);
  const order = buildAggregateOrder(input.orderBy, measure.kind, columns, facets, state);

  const groupSelect: string[] = [];
  const groupKeys: string[] = [];
  if (state) {
    groupSelect.push(`${stateExpr(opts.stateSources!)} AS state_label`);
    groupKeys.push('state_label');
  }
  for (const c of columns) {
    groupSelect.push(c);
    groupKeys.push(c);
  }
  for (const key of facets) {
    groupSelect.push(`(metadata->>'${key}') AS ${facetAlias(key)}`);
    groupKeys.push(facetAlias(key));
  }
  const groupBySql = groupKeys.length ? `GROUP BY ${groupKeys.join(', ')}\n` : '';

  if (measure.kind === 'membership') {
    const asOf = resolveAsOf(measure.asOf);
    if (input.distinctBy !== undefined) requireFacetKey(input.distinctBy, 'distinctBy');
    const countExpr = input.distinctBy
      ? `count(DISTINCT (metadata->>'${input.distinctBy}'))::int`
      : `count(*)::int`;
    let intervalPred: string;
    if (asOf === null) {
      // Now-anchored: the live set IS the membership — same shape and index
      // (stats_pending) as the Pace Board's live counts.
      intervalPred = `status IN (${liveList})`;
    } else {
      params.push(asOf.toISOString());
      const t = `$${params.length}::timestamptz`;
      intervalPred = `created_at <= ${t}\n  AND ${overlapsAfter(liveList, t)}`;
    }
    params.push(pageLimit + 1, offset);
    const sql = `SELECT ${[...groupSelect, `${countExpr} AS "count"`, 'count(*)::int AS sample_count'].join(',\n       ')}
FROM public.lt_escalations
WHERE ${where}
  AND ${intervalPred}
${groupBySql}ORDER BY ${order}
LIMIT $${params.length - 1} OFFSET $${params.length}`;
    return { sql, params, pageLimit, columns, facets, stateGrouped: state, measureKind: 'membership', nowAnchored: asOf === null };
  }

  // Dwell: clip each overlapping interval to the window, sum open-seconds.
  if (input.distinctBy !== undefined) {
    throw new AnalyticsInputError(
      'distinctBy is a membership concept — for per-entity dwell, put the entity facet in groupBy.facets',
    );
  }
  const win = resolveWindow(measure.window, 'measure.window');
  if (!win) throw new AnalyticsInputError('measure.window is required for dwell');
  params.push(win.from.toISOString());
  const fromP = `$${params.length}::timestamptz`;
  params.push(win.to.toISOString());
  const toP = `$${params.length}::timestamptz`;
  const spanSelect = [
    ...groupSelect,
    `GREATEST(created_at, ${fromP}) AS s`,
    // Open rows clamp to now, not to the window end: a caller may round the
    // window end into the near future (cache-key stability), and an open row
    // must not accrue seconds that haven't elapsed.
    `LEAST(COALESCE(${endedAtExpr(liveList)}, LEAST(NOW(), ${toP})), ${toP}) AS e`,
  ];
  params.push(pageLimit + 1, offset);
  const sql = `WITH span AS (
  SELECT ${spanSelect.join(',\n         ')}
  FROM public.lt_escalations
  WHERE ${where}
    AND created_at < ${toP}
    AND ${overlapsAfter(liveList, fromP)}
)
SELECT ${[...groupKeys, 'SUM(EXTRACT(EPOCH FROM (e - s)))::float8 AS dwell_seconds', 'count(*)::int AS sample_count'].join(',\n       ')}
FROM span
${groupBySql}ORDER BY ${order}
LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return { sql, params, pageLimit, columns, facets, stateGrouped: state, measureKind: 'dwell', nowAnchored: win.nowAnchored };
}

/** Build the single-entity interval sequence, created_at-ordered, gaps preserved. */
export function buildTimelineQuery(input: TimelineByFacetInput): BuiltTimelineQuery {
  requireFacetKey(input?.facet?.key, 'facet.key');
  if (typeof input.facet.value !== 'string' || input.facet.value.length === 0) {
    throw new AnalyticsInputError(
      'facet.value must be a non-empty string (entity facets are matched as JSON strings)',
    );
  }
  const query = requireCleanFilter(input.query);
  if (query.entity !== undefined) {
    throw new AnalyticsInputError('query.entity must be resolved to roles before building SQL');
  }
  // select.columns narrows which columns the mapper surfaces; omitted = all.
  const { columns, facets } = resolveGroupBy({
    columns: input.select?.columns ?? [...GROUPABLE_COLUMNS],
    facets: input.select?.facets,
  });
  const live = resolveLiveStatuses(input.liveStatuses);
  const liveList = statusLiterals(live);
  const win = resolveWindow(input.window);
  const { order, before } = resolveTimelinePage(input.order, input.before);
  const { pageLimit } = resolvePage(input.limit, undefined);

  // GIN-served entity match; buildFacetWhere composes any extra filter after it.
  const params: unknown[] = [JSON.stringify({ [input.facet.key]: input.facet.value })];
  const clauses = [`metadata @> $1::jsonb`, buildFacetWhere(query, params)];
  let clampEnd = 'NOW()';
  if (win) {
    params.push(win.from.toISOString());
    const fromP = `$${params.length}::timestamptz`;
    params.push(win.to.toISOString());
    const toP = `$${params.length}::timestamptz`;
    clauses.push(`created_at < ${toP}`, overlapsAfter(liveList, fromP));
    clampEnd = `LEAST(NOW(), ${toP})`;
  }
  // The "load earlier" cursor: strictly-older intervals than the oldest the
  // client already holds. One entity's rows are few; the sort is trivial.
  if (before) {
    params.push(before.toISOString());
    clauses.push(`created_at < $${params.length}::timestamptz`);
  }
  const ended = endedAtExpr(liveList);
  const facetSelect = facets.map((key) => `(metadata->>'${key}') AS ${facetAlias(key)}`);
  params.push(pageLimit + 1);
  const sql = `SELECT ${['role', 'subtype', 'status', ...facetSelect].join(', ')},
       created_at AS started_at,
       ${ended} AS ended_at,
       EXTRACT(EPOCH FROM (COALESCE(${ended}, ${clampEnd}) - created_at))::float8 AS duration_seconds
FROM public.lt_escalations
WHERE ${clauses.join('\n  AND ')}
ORDER BY created_at ${order === 'desc' ? 'DESC' : 'ASC'}
LIMIT $${params.length}`;
  return { sql, params, pageLimit, columns, facets, nowAnchored: !win || win.nowAnchored };
}
