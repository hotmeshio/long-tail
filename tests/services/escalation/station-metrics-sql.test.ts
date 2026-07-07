import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as escalationService from '../../../services/escalation';
import * as roleService from '../../../services/role';
import { resetStationMetricsCache } from '../../../services/escalation/queries';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// Station metrics — the SQL itself, against real Postgres.
//
// The Operations page's P99 WAIT / P99 WORK / throughput numbers come from
// STATION_LIVE_COUNTS_SQL and STATION_PERIOD_METRICS_SQL. The unit suite
// proves the JS mapping over mocked rows; this suite seeds real rows with
// backdated timestamps so the aggregates themselves are pinned:
//
//   wait = claimed_at - created_at, work = resolved_at - claimed_at,
//   priority_count = pending UNCLAIMED rows older than the role's threshold
//     (age from priority_facet metadata, created_at fallback; threshold from
//     priority_threshold_minutes, sla_minutes fallback),
//   resolved = closed within the window ONLY (window bounding),
//   throughput_pct = resolved / (target_per_hour × window_hours) × 100.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE = `station-sql-${Date.now()}`;
const OPERATOR = 'station-sql-tester';
const createdIds: string[] = [];

async function seedEscalation(): Promise<string> {
  const rec = await escalationService.createEscalation({
    type: 'station-sql-case',
    role: ROLE,
    description: 'station metrics seed row',
  });
  createdIds.push(rec.id);
  return rec.id;
}

describe('station metrics SQL (integration)', () => {
  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await roleService.createRole(ROLE);
    // SLA 5m and 60/h target: with a 1h window, 1 resolved row = 1.7%.
    await roleService.updateRoleMetadata(ROLE, { sla_minutes: 5, target_per_hour: 60 });

    const pool = getPool();

    // Row 1 — fresh pending: counts toward pending only.
    await seedEscalation();

    // Row 2 — pending unclaimed, 10 minutes old with a 5-minute SLA: priority
    // via the created_at fallback (no facet configured on this role).
    const overdueId = await seedEscalation();
    await pool.query(
      `UPDATE public.hmsh_escalations SET created_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
      [overdueId],
    );

    // Row 3 — actively claimed (still status='pending' in the implicit model).
    const claimedId = await seedEscalation();
    await escalationService.claimEscalation(claimedId, OPERATOR, 30);

    // Row 4 — resolved inside the window with exact deltas:
    // wait = claimed_at - created_at = 10m, work = resolved_at - claimed_at = 10m.
    const resolvedId = await seedEscalation();
    await escalationService.claimEscalation(resolvedId, OPERATOR, 30);
    await escalationService.resolveEscalation(resolvedId, { done: true });
    await pool.query(
      `UPDATE public.hmsh_escalations
       SET created_at  = NOW() - INTERVAL '30 minutes',
           claimed_at  = NOW() - INTERVAL '20 minutes',
           resolved_at = NOW() - INTERVAL '10 minutes'
       WHERE id = $1`,
      [resolvedId],
    );

    // Row 5 — resolved OUTSIDE the 1h window: must be excluded by the
    // resolved_at range (this is the bound that keeps the scan off history).
    const staleId = await seedEscalation();
    await escalationService.claimEscalation(staleId, OPERATOR, 30);
    await escalationService.resolveEscalation(staleId, { done: true });
    await pool.query(
      `UPDATE public.hmsh_escalations
       SET created_at  = NOW() - INTERVAL '3 hours',
           claimed_at  = NOW() - INTERVAL '150 minutes',
           resolved_at = NOW() - INTERVAL '2 hours'
       WHERE id = $1`,
      [staleId],
    );

    resetStationMetricsCache();
  }, 60_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM public.hmsh_escalations WHERE id = ANY($1::uuid[])', [createdIds]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('computes live counts, window-bounded resolved, exact percentiles, and throughput', async () => {
    const stations = await escalationService.getStationMetrics([ROLE], '1h');
    expect(stations).toHaveLength(1);
    const s = stations[0];

    expect(s.role).toBe(ROLE);
    // Rows 1 (fresh), 2 (overdue), 3 (claimed) are the live backlog.
    expect(s.pending).toBe(3);
    expect(s.claimed).toBe(1);
    expect(s.priority_count).toBe(1);

    // Only row 4 resolved inside the window — row 5 (2h old) is excluded.
    expect(s.resolved).toBe(1);

    // One resolved row → every percentile equals its exact deltas.
    expect(s.wait.p99).toBeCloseTo(10, 1);
    expect(s.wait.p50).toBeCloseTo(10, 1);
    expect(s.wait.avg).toBeCloseTo(10, 1);
    expect(s.wait.max).toBeCloseTo(10, 1);
    expect(s.work.p99).toBeCloseTo(10, 1);
    expect(s.work.p50).toBeCloseTo(10, 1);
    expect(s.work.avg).toBeCloseTo(10, 1);
    expect(s.work.max).toBeCloseTo(10, 1);

    // 1 resolved vs a 60/h target over 1h → 1.7%.
    expect(s.throughput_pct).toBeCloseTo(1.7, 1);
  }, 30_000);

  it('a wider window includes the older resolved row and shifts the percentiles', async () => {
    resetStationMetricsCache();
    const stations = await escalationService.getStationMetrics([ROLE], '7d');
    const s = stations[0];

    expect(s.resolved).toBe(2);
    // Row 5 waited 30m and worked 30m; row 4 did 10m/10m. p99 tracks the max.
    expect(s.work.max).toBeCloseTo(30, 1);
    expect(s.work.p99).toBeGreaterThan(10);
    expect(s.wait.max).toBeCloseTo(30, 1);
  }, 30_000);

  it('an idle configured role still appears, with zeroed counts and null latencies', async () => {
    const idleRole = `${ROLE}-idle`;
    await roleService.createRole(idleRole);
    await roleService.updateRoleMetadata(idleRole, { target_per_hour: 10 });
    try {
      resetStationMetricsCache();
      const stations = await escalationService.getStationMetrics([idleRole], '1h');
      expect(stations).toHaveLength(1);
      const s = stations[0];
      expect(s.pending).toBe(0);
      expect(s.claimed).toBe(0);
      expect(s.resolved).toBe(0);
      expect(s.priority_count).toBe(0);
      expect(s.wait.p99).toBeNull();
      expect(s.work.p99).toBeNull();
      // Target configured but zero resolved → 0%, never null.
      expect(s.throughput_pct).toBe(0);
    } finally {
      await getPool().query('DELETE FROM lt_roles WHERE role = $1', [idleRole]);
    }
  }, 30_000);

  it('the station percentile cover index exists and is valid', async () => {
    const { rows } = await getPool().query(`
      SELECT i.indisvalid AS valid
      FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'idx_hmsh_esc_resolved_cover' AND n.nspname = 'public'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].valid).toBe(true);
  });
});
