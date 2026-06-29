// ---------------------------------------------------------------------------
// Role-overview attainment SQL — a SINGLE grouped query per call.
//
// The one MEASURED truth is per-unit TAT: (resolved_at − created_at) / units.
// Everything the overview shows is that quantity — its distribution over time
// (p50/p99 are two views of the same measured value), and its comparison to the
// one declared target (lt_role_dials.target_tat_seconds → the 100% line).
//
// Two lenses share one builder:
//   - station  : continuous time series (stations × bucket grid LEFT JOIN agg),
//                attainment_pct = target_tat / measured per-unit TAT.
//   - servicer : per-identity (or per account_type cohort) per-unit TAT — the
//                grounded human-vs-AI comparison.
//
// Quantity goals, upstream-flow modeling, and scenario knobs are dynamic UI
// concerns, deliberately NOT computed here. Epoch-floor bucketing keeps the SQL
// portable (no date_bin). Facet keys bind as `metadata ->> $n`; read-scope and
// the FacetQuery WHERE fold into the same windowed scan.
// ---------------------------------------------------------------------------

import { buildFacetWhere, buildReadScopeWhere } from './facet-sql';
import type { ReadScope } from './facet-sql';
import type { FacetQuery } from '../../types';

/** Selectable windows → window span and bucket width (seconds). */
export const ATTAINMENT_RANGES = {
  '15m': { windowSeconds: 900,     bucketSeconds: 60    }, // 15 × 1m
  '1h':  { windowSeconds: 3600,    bucketSeconds: 300   }, // 12 × 5m
  '1d':  { windowSeconds: 86400,   bucketSeconds: 3600  }, // 24 × 1h
  '7d':  { windowSeconds: 604800,  bucketSeconds: 21600 }, // 28 × 6h
  '30d': { windowSeconds: 2592000, bucketSeconds: 86400 }, // 30 × 1d
} as const;

export type AttainmentRangeKey = keyof typeof ATTAINMENT_RANGES;

export function isAttainmentRange(value: unknown): value is AttainmentRangeKey {
  return typeof value === 'string' && value in ATTAINMENT_RANGES;
}

export const STATION_FACET_DEFAULT = 'station';

/** Which dimension the rows are grouped by. */
export const ATTAINMENT_PIVOTS = {
  STATION: 'station',
  SERVICER: 'servicer',
} as const;
export type AttainmentPivot = (typeof ATTAINMENT_PIVOTS)[keyof typeof ATTAINMENT_PIVOTS];

export function isAttainmentPivot(value: unknown): value is AttainmentPivot {
  return value === ATTAINMENT_PIVOTS.STATION || value === ATTAINMENT_PIVOTS.SERVICER;
}

/** Servicer cohorting — the only cohort today buckets human (`user`) vs AI (`bot`). */
export const SERVICER_COHORTS = {
  ACCOUNT_TYPE: 'account_type',
} as const;
export type ServicerCohort = (typeof SERVICER_COHORTS)[keyof typeof SERVICER_COHORTS];

export function isServicerCohort(value: unknown): value is ServicerCohort {
  return value === SERVICER_COHORTS.ACCOUNT_TYPE;
}

/**
 * Lazily-ensured partial btree for the windowed resolved-row scan. Targets the
 * real `public.hmsh_escalations` table (engine-created), so it cannot live in a
 * static migration. The GIN on metadata serves `@>` only — this drives the time
 * range scan.
 */
export const ENSURE_ATTAINMENT_INDEX =
  `CREATE INDEX IF NOT EXISTS idx_hmsh_escalations_resolved_overview
     ON public.hmsh_escalations (role, resolved_at)
     WHERE status = 'resolved' AND resolved_at IS NOT NULL`;

export interface BuildAttainmentOpts {
  role: string;
  rangeStartEpoch: number;
  rangeEndEpoch: number;
  bucketSeconds: number;
  nBuckets: number;
  pivot: AttainmentPivot;
  stationFacet: string;
  /** Metadata facet holding the unit count; null = one unit per resolved row. */
  unitFacet: string | null;
  assignedTo?: string;
  cohortBy?: ServicerCohort;
  facet: FacetQuery;
  scope: ReadScope;
}

/**
 * Assemble the attainment query and its bound params. ONE statement, ONE round
 * trip — verified by tests asserting a single pool.query call.
 */
export function buildAttainmentSql(o: BuildAttainmentOpts): { sql: string; params: unknown[] } {
  const p: unknown[] = [];
  const pRole = p.push(o.role);
  const pStation = p.push(o.stationFacet);
  const pStart = p.push(o.rangeStartEpoch);
  const pEnd = p.push(o.rangeEndEpoch);
  const pBucket = p.push(o.bucketSeconds);
  const pUnit = o.unitFacet ? p.push(o.unitFacet) : null;

  // Windowed scan predicate — read-scope and the extra FacetQuery fold in here.
  const where: string[] = [
    `status = 'resolved'`,
    `resolved_at IS NOT NULL`,
    `resolved_at >= to_timestamp($${pStart}::float8)`,
    `resolved_at <  to_timestamp($${pEnd}::float8)`,
    `role = $${pRole}`,
  ];
  const scopeClause = buildReadScopeWhere(o.scope, p);
  if (scopeClause) where.push(scopeClause);
  const facetClause = buildFacetWhere(o.facet, p);
  if (facetClause !== 'TRUE') where.push(facetClause);
  if (o.assignedTo) where.push(`assigned_to = $${p.push(o.assignedTo)}`);

  // units defaults to 1 (and is floored at 1) so per-unit TAT is always defined.
  const units = pUnit ? `GREATEST(COALESCE((metadata ->> $${pUnit})::numeric, 1), 1)` : `1`;

  // Single windowed projection; unqualified columns resolve to lt_escalations.
  const scoped = `
    scoped AS (
      SELECT
        assigned_to,
        metadata ->> $${pStation}                                       AS station_key,
        EXTRACT(EPOCH FROM (resolved_at - created_at)) / (${units})     AS per_unit_secs,
        floor((EXTRACT(EPOCH FROM resolved_at) - $${pStart}::float8)
              / $${pBucket}::float8)::int                               AS idx
      FROM public.lt_escalations
      WHERE ${where.join('\n        AND ')}
    )`;

  // Per-unit TAT percentiles — the same measured quantity at two quantiles.
  const metrics = `
    count(*)::int                                                       AS count_resolved,
    (percentile_cont(0.5)  WITHIN GROUP (ORDER BY per_unit_secs) * 1000)::float8 AS tat_p50_ms,
    (percentile_cont(0.99) WITHIN GROUP (ORDER BY per_unit_secs) * 1000)::float8 AS tat_p99_ms`;

  if (o.pivot === ATTAINMENT_PIVOTS.SERVICER) {
    const cohort = o.cohortBy === SERVICER_COHORTS.ACCOUNT_TYPE;
    const servicerKey = cohort ? 'u.account_type' : 's.assigned_to';
    const join = cohort ? 'LEFT JOIN lt_users u ON u.id::text = s.assigned_to' : '';
    const sql = `
      WITH ${scoped}
      SELECT
        ${servicerKey} AS servicer_key,
        ${metrics}
      FROM scoped s
      ${join}
      WHERE s.assigned_to IS NOT NULL
      GROUP BY ${servicerKey}
      ORDER BY count_resolved DESC`;
    return { sql, params: p };
  }

  // Station lens — every station seen in the window (target optional via dial),
  // CROSS JOIN the bucket grid so the line stays continuous and percentile_cont
  // only ever runs over non-empty groups (inside agg).
  const pNBuckets = p.push(o.nBuckets);
  const sql = `
    WITH ${scoped},
    stations AS (
      SELECT DISTINCT
        s.station_key,
        d.target_tat_seconds::float8 AS target_tat_seconds
      FROM scoped s
      LEFT JOIN lt_role_dials d ON d.role = $${pRole} AND d.station_key = s.station_key
      WHERE s.station_key IS NOT NULL
    ),
    grid AS (
      SELECT st.station_key, st.target_tat_seconds, g AS idx
      FROM stations st
      CROSS JOIN generate_series(0, $${pNBuckets}::int - 1) AS g
    ),
    agg AS (
      SELECT station_key, idx, ${metrics}
      FROM scoped
      WHERE station_key IS NOT NULL
      GROUP BY station_key, idx
    )
    SELECT
      g.station_key,
      g.idx,
      to_timestamp($${pStart}::float8 + g.idx * $${pBucket}::float8)         AS bucket_start,
      to_timestamp($${pStart}::float8 + (g.idx + 1) * $${pBucket}::float8)   AS bucket_end,
      (g.target_tat_seconds * 1000)::float8                                  AS target_tat_ms,
      a.tat_p50_ms,
      a.tat_p99_ms,
      CASE
        WHEN g.target_tat_seconds IS NOT NULL AND a.tat_p50_ms > 0
        THEN ((g.target_tat_seconds * 1000) / a.tat_p50_ms * 100)::float8
        ELSE NULL
      END                                                                    AS attainment_pct,
      COALESCE(a.count_resolved, 0)::int                                     AS count_resolved
    FROM grid g
    LEFT JOIN agg a ON a.station_key = g.station_key AND a.idx = g.idx
    ORDER BY g.station_key, g.idx`;
  return { sql, params: p };
}
