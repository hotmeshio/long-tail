// ---------------------------------------------------------------------------
// Role-overview attainment service.
//
// The role lens (computeAttainment) and the servicer lens (computeServicerProfile)
// both run a single grouped query via buildAttainmentSql. setBaseline freezes the
// station lens into an immutable snapshot in ONE atomic INSERT … SELECT (no
// read-then-write). All percentile/throughput math lives in Postgres.
// ---------------------------------------------------------------------------

import { getPool } from '../../lib/db';
import { ensureEscalationCompatView } from './client';
import {
  ATTAINMENT_RANGES,
  ATTAINMENT_PIVOTS,
  ENSURE_ATTAINMENT_INDEX,
  STATION_FACET_DEFAULT,
  buildAttainmentSql,
} from './attainment-sql';
import type {
  AttainmentRangeKey,
  AttainmentPivot,
  ServicerCohort,
} from './attainment-sql';
import type { ReadScope } from './facet-sql';
import type { FacetQuery } from '../../types';

export interface AttainmentQuery {
  role: string;
  range: AttainmentRangeKey;
  /** Window end (epoch seconds); defaults to now. Buckets anchor to the start. */
  nowEpoch?: number;
  stationFacet?: string;
  /** Metadata facet holding the unit count; null = one unit per resolved row. */
  unitFacet?: string | null;
  facet?: FacetQuery;
  scope: ReadScope;
}

export interface ServicerQuery extends AttainmentQuery {
  /** Profile a single identity (internal user id). */
  assignedTo?: string;
  /** Cohort the rows (e.g. by account_type = human vs AI). */
  cohortBy?: ServicerCohort;
}

/**
 * One station, one time bucket — the role lens. Per-unit TAT is the measured
 * spine; targetTatMs is the declared promise; attainmentPct = target ÷ measured
 * p50 (100% = holding the promise, >100% = faster), null when no target is set.
 */
export interface AttainmentBucket {
  stationKey: string;
  bucketStart: Date;
  bucketEnd: Date;
  targetTatMs: number | null;
  tatP50Ms: number | null;
  tatP99Ms: number | null;
  attainmentPct: number | null;
  countResolved: number;
}

/** One servicer (or cohort) over the window — per-unit TAT, the servicer lens. */
export interface ServicerBucket {
  servicerKey: string;
  countResolved: number;
  tatP50Ms: number | null;
  tatP99Ms: number | null;
}

export interface BaselineRef {
  id: string;
  label: string | null;
  rangeKey: string;
  windowStart: Date;
  windowEnd: Date;
  snapshot: AttainmentBucket[];
  createdAt: Date;
}

let ready: Promise<void> | null = null;

/** Ensure the compat view + the windowed-scan index exist before the first query. */
export function ensureAttainmentReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureEscalationCompatView();
      await getPool().query(ENSURE_ATTAINMENT_INDEX);
    })().catch((err) => {
      ready = null; // let a transient failure be retried
      throw err;
    });
  }
  return ready;
}

interface ResolvedWindow {
  rangeStartEpoch: number;
  rangeEndEpoch: number;
  bucketSeconds: number;
  nBuckets: number;
}

function resolveWindow(q: AttainmentQuery): ResolvedWindow {
  const range = ATTAINMENT_RANGES[q.range];
  if (!range) throw new Error(`Unknown attainment range: ${q.range}`);
  const rangeEndEpoch = q.nowEpoch ?? Math.floor(Date.now() / 1000);
  return {
    rangeEndEpoch,
    rangeStartEpoch: rangeEndEpoch - range.windowSeconds,
    bucketSeconds: range.bucketSeconds,
    nBuckets: Math.round(range.windowSeconds / range.bucketSeconds),
  };
}

function commonOpts(q: AttainmentQuery, w: ResolvedWindow) {
  return {
    role: q.role,
    rangeStartEpoch: w.rangeStartEpoch,
    rangeEndEpoch: w.rangeEndEpoch,
    bucketSeconds: w.bucketSeconds,
    nBuckets: w.nBuckets,
    stationFacet: q.stationFacet ?? STATION_FACET_DEFAULT,
    unitFacet: q.unitFacet ?? null,
    facet: q.facet ?? {},
    scope: q.scope,
  };
}

function mapAttainmentRow(r: any): AttainmentBucket {
  return {
    stationKey: r.station_key,
    bucketStart: r.bucket_start,
    bucketEnd: r.bucket_end,
    targetTatMs: r.target_tat_ms,
    tatP50Ms: r.tat_p50_ms,
    tatP99Ms: r.tat_p99_ms,
    attainmentPct: r.attainment_pct,
    countResolved: r.count_resolved,
  };
}

/** Role lens — per-station, per-bucket attainment over the window. */
export async function computeAttainment(q: AttainmentQuery): Promise<AttainmentBucket[]> {
  await ensureAttainmentReady();
  const w = resolveWindow(q);
  const { sql, params } = buildAttainmentSql({
    ...commonOpts(q, w),
    pivot: ATTAINMENT_PIVOTS.STATION,
  });
  const { rows } = await getPool().query(sql, params);
  return rows.map(mapAttainmentRow);
}

/** Servicer lens — per-identity (or per cohort) scorecard over the window. */
export async function computeServicerProfile(q: ServicerQuery): Promise<ServicerBucket[]> {
  await ensureAttainmentReady();
  const w = resolveWindow(q);
  const { sql, params } = buildAttainmentSql({
    ...commonOpts(q, w),
    pivot: ATTAINMENT_PIVOTS.SERVICER,
    assignedTo: q.assignedTo,
    cohortBy: q.cohortBy,
  });
  const { rows } = await getPool().query(sql, params);
  return rows.map((r: any): ServicerBucket => ({
    servicerKey: r.servicer_key,
    countResolved: r.count_resolved,
    tatP50Ms: r.tat_p50_ms,
    tatP99Ms: r.tat_p99_ms,
  }));
}

export interface SetBaselineInput extends AttainmentQuery {
  label?: string;
  createdBy?: string;
}

/**
 * Freeze the current station-lens result as an immutable baseline in ONE atomic
 * INSERT … SELECT: the snapshot is computed inline under a single MVCC snapshot,
 * so it is provably the same result computeAttainment would return — no TOCTOU.
 */
export async function setBaseline(input: SetBaselineInput): Promise<{ id: string; createdAt: Date }> {
  await ensureAttainmentReady();
  const w = resolveWindow(input);
  const { sql: inner, params } = buildAttainmentSql({
    ...commonOpts(input, w),
    pivot: ATTAINMENT_PIVOTS.STATION,
  });

  const pRole = params.push(input.role);
  const pLabel = params.push(input.label ?? null);
  const pRangeKey = params.push(input.range);
  const pWinStart = params.push(w.rangeStartEpoch);
  const pWinEnd = params.push(w.rangeEndEpoch);
  const pFacet = params.push(JSON.stringify(input.facet ?? {}));
  const pCreatedBy = params.push(input.createdBy ?? null);

  const sql = `
    INSERT INTO lt_role_baselines
      (role, label, range_key, window_start, window_end, snapshot, facet_query, created_by)
    SELECT
      $${pRole}, $${pLabel}, $${pRangeKey},
      to_timestamp($${pWinStart}::float8), to_timestamp($${pWinEnd}::float8),
      COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.station_key, m.idx), '[]'::jsonb),
      $${pFacet}::jsonb, $${pCreatedBy}::uuid
    FROM ( ${inner} ) m
    RETURNING id, created_at`;

  const { rows } = await getPool().query(sql, params);
  return { id: rows[0].id, createdAt: rows[0].created_at };
}

function mapSnapshotEntry(e: any): AttainmentBucket {
  return {
    stationKey: e.station_key,
    bucketStart: new Date(e.bucket_start),
    bucketEnd: new Date(e.bucket_end),
    targetTatMs: e.target_tat_ms,
    tatP50Ms: e.tat_p50_ms,
    tatP99Ms: e.tat_p99_ms,
    attainmentPct: e.attainment_pct,
    countResolved: e.count_resolved,
  };
}

/** The most recently saved baseline for a role, or null if none. */
export async function getLatestBaseline(role: string): Promise<BaselineRef | null> {
  const { rows } = await getPool().query(
    `SELECT id, label, range_key, window_start, window_end, snapshot, created_at
       FROM lt_role_baselines
      WHERE role = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [role],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    label: r.label,
    rangeKey: r.range_key,
    windowStart: r.window_start,
    windowEnd: r.window_end,
    snapshot: Array.isArray(r.snapshot) ? r.snapshot.map(mapSnapshotEntry) : [],
    createdAt: r.created_at,
  };
}

/** Lightweight list of a role's saved baselines (no snapshot payload). */
export async function listBaselines(
  role: string,
): Promise<Array<{ id: string; label: string | null; rangeKey: string; createdAt: Date }>> {
  const { rows } = await getPool().query(
    `SELECT id, label, range_key, created_at
       FROM lt_role_baselines
      WHERE role = $1
      ORDER BY created_at DESC`,
    [role],
  );
  return rows.map((r: any) => ({
    id: r.id,
    label: r.label,
    rangeKey: r.range_key,
    createdAt: r.created_at,
  }));
}
