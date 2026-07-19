import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as escalationService from '../../../services/escalation';
import * as roleService from '../../../services/role';

const { Connection } = Durable;

// ─────────────────────────────────────────────────────────────────────────────
// Jeopardy parity — against real Postgres.
//
// Contract: the faceted `jeopardy: true` predicate is the SAME expression that
// produces the Pace Board's priority_count, so for any role the jeopardy list's
// total equals the pill's count — the plant manager's "exactly these n items".
// Age origin: the role's priority_facet metadata timestamp (created_at when
// unset); threshold: priority_threshold_minutes (sla_minutes when unset);
// unclaimed only (available: true); no dials → no rows.
// ─────────────────────────────────────────────────────────────────────────────

const STAMP = Date.now();
const FACET_ROLE = `jeop-facet-${STAMP}`;
const FALLBACK_ROLE = `jeop-created-${STAMP}`;
const UNDIALED_ROLE = `jeop-none-${STAMP}`;
const createdIds: string[] = [];

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function seed(role: string, metadata: Record<string, unknown>): Promise<string> {
  const rec = await escalationService.createEscalation({
    type: 'jeopardy-case',
    role,
    envelope: '{}',
    description: `jeopardy parity row`,
    metadata,
  });
  createdIds.push(rec.id);
  return rec.id;
}

async function jeopardyList(role: string) {
  return escalationService.searchEscalationsFaceted({
    global: true,
    facet: { role, status: 'pending', available: true, jeopardy: true },
    limit: 50,
    offset: 0,
  });
}

async function priorityCount(role: string): Promise<number> {
  const stations = await escalationService.getStationMetrics([role], '24h');
  return stations.find((s) => s.role === role)?.priority_count ?? 0;
}

describe('jeopardy predicate parity (integration)', () => {
  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await roleService.createRole(FACET_ROLE);
    await roleService.createRole(FALLBACK_ROLE);
    await roleService.createRole(UNDIALED_ROLE);
    // Facet-driven role: age measured from metadata.authorized_at, 15m limit.
    await roleService.updateRoleMetadata(FACET_ROLE, {
      priority_threshold_minutes: 15,
      priority_facet: 'authorized_at',
    });
    // Fallback role: no facet — age measured from created_at, 15m limit.
    await roleService.updateRoleMetadata(FALLBACK_ROLE, {
      priority_threshold_minutes: 15,
    });
  }, 60_000);

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM public.hmsh_escalations WHERE id = ANY($1::uuid[])', [createdIds]);
    await pool.query('DELETE FROM lt_roles WHERE role = ANY($1::text[])', [[FACET_ROLE, FALLBACK_ROLE, UNDIALED_ROLE]]);
  });

  it('facet-driven role: list equals pill count; fresh, malformed, and claimed rows excluded', async () => {
    const overdueA = await seed(FACET_ROLE, { authorized_at: minutesAgo(30) });
    const overdueB = await seed(FACET_ROLE, { authorized_at: minutesAgo(45) });
    await seed(FACET_ROLE, { authorized_at: minutesAgo(5) });          // inside the limit
    await seed(FACET_ROLE, { authorized_at: 'not-a-timestamp' });      // guarded cast → excluded
    await seed(FACET_ROLE, {});                                        // facet missing → excluded
    const claimed = await seed(FACET_ROLE, { authorized_at: minutesAgo(60) });
    await escalationService.claimEscalation(claimed, 'runner-1', 30);  // held → not in the pool

    const count = await priorityCount(FACET_ROLE);
    const list = await jeopardyList(FACET_ROLE);

    expect(count).toBe(2);
    expect(list.total).toBe(count);
    expect(list.escalations.map((e) => e.id).sort()).toEqual([overdueA, overdueB].sort());
  });

  it('created_at fallback role: backdated rows count, recent rows do not', async () => {
    const old = await seed(FALLBACK_ROLE, {});
    await seed(FALLBACK_ROLE, {}); // fresh — inside the limit
    await getPool().query(
      `UPDATE public.hmsh_escalations SET created_at = NOW() - INTERVAL '30 minutes' WHERE id = $1`,
      [old],
    );

    const count = await priorityCount(FALLBACK_ROLE);
    const list = await jeopardyList(FALLBACK_ROLE);

    expect(count).toBe(1);
    expect(list.total).toBe(1);
    expect(list.escalations[0].id).toBe(old);
  });

  it('role with no dials contributes no rows, however old', async () => {
    const old = await seed(UNDIALED_ROLE, {});
    await getPool().query(
      `UPDATE public.hmsh_escalations SET created_at = NOW() - INTERVAL '2 days' WHERE id = $1`,
      [old],
    );

    expect(await priorityCount(UNDIALED_ROLE)).toBe(0);
    expect((await jeopardyList(UNDIALED_ROLE)).total).toBe(0);
  });

  it('jeopardy orders by the age-origin facet ascending — oldest first, as the deeplink sorts', async () => {
    const list = await escalationService.searchEscalationsFaceted({
      global: true,
      facet: {
        role: FACET_ROLE, status: 'pending', available: true, jeopardy: true,
        orderBy: [{ field: 'metadata.authorized_at', direction: 'asc' }],
      },
      limit: 50,
      offset: 0,
    });
    const stamps = list.escalations.map((e) => String((e.metadata as any).authorized_at));
    expect(stamps).toEqual([...stamps].sort());
  });
});
