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
// Station priority count — the facet path, against real Postgres.
//
// station-metrics-sql.test.ts covers the created_at fallback (no facet). This
// suite pins the metadata-facet semantics of STATION_LIVE_COUNTS_SQL:
//
//   - age origin = (metadata->>priority_facet)::timestamptz (ISO 8601 UTC)
//   - threshold  = priority_threshold_minutes (overriding sla_minutes)
//   - claimed items are excluded (the count is what still needs pulling)
//   - missing facet key: not counted
//   - malformed facet value: not counted AND the query does not throw
//     (pg_input_is_valid guards the cast inside a CASE)
// ─────────────────────────────────────────────────────────────────────────────

const ROLE = `station-prio-${Date.now()}`;
const OPERATOR = 'station-prio-tester';
const createdIds: string[] = [];

const isoMinutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function seedEscalation(metadata?: Record<string, any>): Promise<string> {
  const rec = await escalationService.createEscalation({
    type: 'station-prio-case',
    role: ROLE,
    description: 'station priority seed row',
    metadata,
  });
  createdIds.push(rec.id);
  return rec.id;
}

describe('station priority count SQL (integration)', () => {
  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await roleService.createRole(ROLE);
    // sla_minutes deliberately tighter than the priority threshold: the count
    // must honor priority_threshold_minutes, not fall back to the SLA.
    await roleService.updateRoleMetadata(ROLE, {
      sla_minutes: 5,
      priority_threshold_minutes: 60,
      priority_facet: 'authorized_at',
    });

    // Row 1 — authorized 2h ago, unclaimed: past the 60m threshold, counted.
    await seedEscalation({ authorized_at: isoMinutesAgo(120) });

    // Row 2 — authorized 10m ago, unclaimed: past the 5m SLA but inside the
    // 60m threshold — NOT counted (threshold overrides the SLA fallback).
    await seedEscalation({ authorized_at: isoMinutesAgo(10) });

    // Row 3 — facet key missing: not counted, regardless of age.
    const missingId = await seedEscalation({ orderId: 'order-1' });
    await getPool().query(
      `UPDATE public.hmsh_escalations SET created_at = NOW() - INTERVAL '3 hours' WHERE id = $1`,
      [missingId],
    );

    // Row 4 — malformed facet value: not counted, query must not throw.
    await seedEscalation({ authorized_at: 'not-a-timestamp' });

    // Row 5 — authorized 2h ago but actively claimed: excluded.
    const claimedId = await seedEscalation({ authorized_at: isoMinutesAgo(120) });
    await escalationService.claimEscalation(claimedId, OPERATOR, 30);

    resetStationMetricsCache();
  }, 60_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM public.hmsh_escalations WHERE id = ANY($1::uuid[])', [createdIds]);
    await pool.query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
  });

  it('counts only unclaimed rows whose facet timestamp exceeds the threshold', async () => {
    const stations = await escalationService.getStationMetrics([ROLE], '1h');
    expect(stations).toHaveLength(1);
    const s = stations[0];

    expect(s.pending).toBe(5);
    expect(s.claimed).toBe(1);
    // Only row 1: row 2 is fresh, row 3 lacks the key, row 4 is malformed,
    // row 5 is in someone's hands.
    expect(s.priority_count).toBe(1);
  }, 30_000);

  it('an expired claim returns the row to the countable pool', async () => {
    const pool = getPool();
    // Age row 2 past the threshold and expire row 5's claim: both now count.
    await pool.query(
      `UPDATE public.hmsh_escalations
       SET metadata = jsonb_set(metadata, '{authorized_at}', to_jsonb($2::text))
       WHERE id = $1`,
      [createdIds[1], isoMinutesAgo(90)],
    );
    await pool.query(
      `UPDATE public.hmsh_escalations SET assigned_until = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [createdIds[4]],
    );

    resetStationMetricsCache();
    const stations = await escalationService.getStationMetrics([ROLE], '1h');
    const s = stations[0];
    expect(s.claimed).toBe(0);
    expect(s.priority_count).toBe(3);
  }, 30_000);
});
