/**
 * Escalation analytics — membership + the derived interval (D1).
 *
 * Property under test: membership(asOf = T) equals interval containment —
 * every row with created_at <= T that had not left the live set by T, counted
 * against the ACTUAL stored timestamps (read via SQL, not bookkeeping).
 *
 * Requires: docker compose up -d --build
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient, log, pgQuery } from './helpers';

const ROLE_A = 'analytics-line-a';
const ROLE_B = 'analytics-line-b';
const RUN = `run-${Date.now()}`;

let api: ApiClient;
const ids: string[] = [];

async function createRow(role: string, serialNumber: string, subtype: string): Promise<string> {
  const { data } = await api.post('/api/escalations', {
    type: 'analytics-fixture',
    subtype,
    role,
    metadata: { serialNumber, run_id: RUN },
  });
  ids.push(data.id);
  return data.id;
}

function caught(promise: Promise<any>): Promise<{ status: number; data: any }> {
  return promise.catch((err: any) => {
    const match = err.message.match(/→ (\d+): (.+)/);
    return { status: parseInt(match[1], 10), data: JSON.parse(match[2]) };
  });
}

beforeAll(async () => {
  api = new ApiClient();
  await api.login('superadmin', 'l0ngt@1l');
  for (const role of [ROLE_A, ROLE_B]) {
    await api.post('/api/roles', { role }).catch(() => { /* exists */ });
  }
  log('setup', 'roles ready');
}, 120_000);

describe('D1 — the derived ended_at view column', () => {
  it('is NULL while pending, resolved_at after resolve, updated_at after cancel', async () => {
    const pendingId = await createRow(ROLE_A, 'SER-D1-P', 'stage');
    const resolvedId = await createRow(ROLE_A, 'SER-D1-R', 'stage');
    const cancelledId = await createRow(ROLE_A, 'SER-D1-C', 'stage');
    await api.post(`/api/escalations/${resolvedId}/resolve`, { resolverPayload: { done: true } });
    await api.post(`/api/escalations/${cancelledId}/cancel`, { reason: 'fixture' });

    const rows = await pgQuery(
      `SELECT id, status, ended_at, resolved_at, updated_at
       FROM public.lt_escalations WHERE id = ANY($1::uuid[])`,
      [[pendingId, resolvedId, cancelledId]],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(pendingId).ended_at).toBeNull();
    expect(byId.get(resolvedId).ended_at).toEqual(byId.get(resolvedId).resolved_at);
    expect(byId.get(cancelledId).status).toBe('cancelled');
    expect(byId.get(cancelledId).ended_at).toEqual(byId.get(cancelledId).updated_at);
  });
});

describe('membership — brute-force interval containment', () => {
  let anchor: string;

  beforeAll(async () => {
    // Three printers across two lines; close some intervals around an anchor.
    await createRow(ROLE_A, 'SER-001', 'stage');
    const closedBefore = await createRow(ROLE_A, 'SER-002', 'stage');
    await api.post(`/api/escalations/${closedBefore}/resolve`, { resolverPayload: {} });
    await new Promise((r) => setTimeout(r, 1_200));
    anchor = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 1_200));
    // Created after the anchor — open now, absent at the anchor.
    await createRow(ROLE_B, 'SER-003', 'stage');
  });

  async function bruteForce(asOf: string): Promise<number> {
    const rows = await pgQuery(
      `SELECT created_at, ended_at FROM public.lt_escalations
       WHERE metadata->>'run_id' = $1`,
      [RUN],
    );
    const t = new Date(asOf).getTime();
    return rows.filter(
      (r) => new Date(r.created_at).getTime() <= t
        && (r.ended_at == null || new Date(r.ended_at).getTime() > t),
    ).length;
  }

  it('membership now equals the live set', async () => {
    const { data } = await api.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [ROLE_A, ROLE_B], facets: { run_id: RUN } },
      groupBy: {},
      measure: { kind: 'membership' },
    });
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].count).toBe(await bruteForce(new Date().toISOString()));
    expect(data.overflow).toBe(false);
  });

  it('a past asOf reconstructs the live set at that instant', async () => {
    const { data } = await api.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [ROLE_A, ROLE_B], facets: { run_id: RUN } },
      groupBy: { columns: ['role'] },
      measure: { kind: 'membership', asOf: anchor },
    });
    const total = data.groups.reduce((n: number, g: any) => n + g.count, 0);
    expect(total).toBe(await bruteForce(anchor));
    // SER-003 was created after the anchor — its line contributes nothing.
    expect(data.groups.find((g: any) => g.role === ROLE_B)).toBeUndefined();
  });

  it('distinctBy counts entities, not rows', async () => {
    // A second open row for SER-001: row count rises, entity count does not.
    await createRow(ROLE_A, 'SER-001', 'stage');
    const { data } = await api.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [ROLE_A, ROLE_B], facets: { run_id: RUN } },
      groupBy: {},
      measure: { kind: 'membership' },
      distinctBy: 'serialNumber',
    });
    expect(data.groups[0].count).toBeLessThan(data.groups[0].sampleCount);
  });
});

describe('fail-loud (P6/P3)', () => {
  it('an unknown entity key is a 400 naming the configuration gap', async () => {
    const { status, data } = await caught(api.post('/api/escalations/aggregate-by-facets', {
      query: { entity: 'no_such_entity_key' },
      groupBy: {},
      measure: { kind: 'membership' },
    }));
    expect(status).toBe(400);
    expect(data.error).toContain('no roles declare');
  });

  it.each(['status', 'available', 'jeopardy'])('liveness field %s on the filter is a 400', async (field) => {
    const { status } = await caught(api.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [ROLE_A], [field]: field === 'status' ? 'pending' : true },
      groupBy: {},
      measure: { kind: 'membership' },
    }));
    expect(status).toBe(400);
  });

  it('a future asOf and a malformed facet key are 400s', async () => {
    const future = await caught(api.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [ROLE_A] },
      groupBy: {},
      measure: { kind: 'membership', asOf: new Date(Date.now() + 3_600_000).toISOString() },
    }));
    expect(future.status).toBe(400);

    const badKey = await caught(api.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [ROLE_A] },
      groupBy: { facets: ['metadata.serialNumber'] },
      measure: { kind: 'membership' },
    }));
    expect(badKey.status).toBe(400);
  });
});
