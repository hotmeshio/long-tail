/**
 * Escalation analytics — dwell + the derived state label.
 *
 * Property under test: dwell equals a brute-force clipped-interval sweep over
 * the ACTUAL stored timestamps. The window is fully past by query time, so
 * open intervals clamp to the window end and every value is deterministic.
 *
 * Requires: docker compose up -d --build
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient, log, pgQuery } from './helpers';

const LINE_ROLE = 'analytics-dwell-line'; // subtype-source: its subtypes are the states
const BAY_ROLE = 'analytics-dwell-bay';   // role-source: being here IS the state
const RUN = `run-${Date.now()}`;

let api: ApiClient;
let windowFrom: string;
let windowTo: string;

function caught(promise: Promise<any>): Promise<{ status: number; data: any }> {
  return promise.catch((err: any) => {
    const match = err.message.match(/→ (\d+): (.+)/);
    return { status: parseInt(match[1], 10), data: JSON.parse(match[2]) };
  });
}

beforeAll(async () => {
  api = new ApiClient();
  await api.login('superadmin', 'l0ngt@1l');
  for (const role of [LINE_ROLE, BAY_ROLE]) {
    await api.post('/api/roles', { role }).catch(() => { /* exists */ });
  }
  await api.patch(`/api/roles/${LINE_ROLE}`, { entity_facet: 'unitSerial', entity_state_source: 'subtype' });
  await api.patch(`/api/roles/${BAY_ROLE}`, { entity_facet: 'unitSerial', entity_state_source: 'role' });

  // Fixture intervals: two closed, one open (which the window end will clamp).
  windowFrom = new Date(Date.now() - 60_000).toISOString();
  const a = await api.post('/api/escalations', {
    type: 'analytics-fixture', subtype: 'waiting', role: LINE_ROLE,
    metadata: { unitSerial: 'SER-101', run_id: RUN },
  });
  const b = await api.post('/api/escalations', {
    type: 'analytics-fixture', subtype: 'working', role: LINE_ROLE,
    metadata: { unitSerial: 'SER-102', run_id: RUN },
  });
  await api.post('/api/escalations', {
    type: 'analytics-fixture', subtype: 'bay', role: BAY_ROLE,
    metadata: { unitSerial: 'SER-101', run_id: RUN },
  });
  await new Promise((r) => setTimeout(r, 1_500));
  await api.post(`/api/escalations/${a.data.id}/resolve`, { resolverPayload: {} });
  await api.post(`/api/escalations/${b.data.id}/resolve`, { resolverPayload: {} });
  await new Promise((r) => setTimeout(r, 1_200));
  windowTo = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 1_000)); // the window is now fully past
  log('setup', `window [${windowFrom}, ${windowTo})`);
}, 120_000);

/** The clipped-interval sweep the SQL must agree with, keyed by state label. */
async function bruteForceDwell(): Promise<Record<string, number>> {
  const rows = await pgQuery(
    `SELECT role, subtype, created_at, ended_at FROM public.lt_escalations
     WHERE metadata->>'run_id' = $1`,
    [RUN],
  );
  const from = new Date(windowFrom).getTime();
  const to = new Date(windowTo).getTime();
  const out: Record<string, number> = {};
  for (const r of rows) {
    const start = Math.max(new Date(r.created_at).getTime(), from);
    const end = Math.min(r.ended_at ? new Date(r.ended_at).getTime() : to, to);
    if (end <= start) continue;
    const state = r.role === LINE_ROLE ? r.subtype : r.role;
    out[state] = (out[state] ?? 0) + (end - start) / 1000;
  }
  return out;
}

describe('dwell — brute-force clipped-interval sweep', () => {
  it('groupBy.state sums open-seconds per derived state, per each role\'s dial', async () => {
    const { data } = await api.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [LINE_ROLE, BAY_ROLE], facets: { run_id: RUN } },
      groupBy: { state: true },
      measure: { kind: 'dwell', window: { from: windowFrom, to: windowTo } },
    });
    const expected = await bruteForceDwell();
    const got = Object.fromEntries(data.groups.map((g: any) => [g.state, g.dwellSeconds]));

    // The subtype-source role contributes its subtypes; the role-source role is its state.
    expect(Object.keys(got).sort()).toEqual(Object.keys(expected).sort());
    expect(Object.keys(got).sort()).toEqual([BAY_ROLE, 'waiting', 'working'].sort());
    for (const [state, seconds] of Object.entries(expected)) {
      expect(got[state]).toBeCloseTo(seconds, 1);
    }
  });

  it('query.entity resolves the system server-side — the Q1 one-liner shape', async () => {
    const { data } = await api.post('/api/escalations/aggregate-by-facets', {
      query: { entity: 'unitSerial', facets: { run_id: RUN } },
      groupBy: { state: true },
      measure: { kind: 'dwell', window: { from: windowFrom, to: windowTo } },
    });
    const states = data.groups.map((g: any) => g.state);
    expect(states).toContain('waiting');
    expect(states).toContain(BAY_ROLE);
  });

  it('slicing by a facet gives each value an independent state split (Q2)', async () => {
    const { data } = await api.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [LINE_ROLE, BAY_ROLE], facets: { run_id: RUN } },
      groupBy: { state: true, facets: ['unitSerial'] },
      measure: { kind: 'dwell', window: { from: windowFrom, to: windowTo } },
    });
    const ser101 = data.groups.filter((g: any) => g.facets.unitSerial === 'SER-101');
    const ser102 = data.groups.filter((g: any) => g.facets.unitSerial === 'SER-102');
    expect(ser101.map((g: any) => g.state).sort()).toEqual([BAY_ROLE, 'waiting']);
    expect(ser102.map((g: any) => g.state)).toEqual(['working']);
  });

  it('caps result groups with an explicit overflow flag — never silent truncation', async () => {
    const { data } = await api.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [LINE_ROLE, BAY_ROLE], facets: { run_id: RUN } },
      groupBy: { state: true },
      measure: { kind: 'dwell', window: { from: windowFrom, to: windowTo } },
      limit: 1,
    });
    expect(data.groups).toHaveLength(1);
    expect(data.overflow).toBe(true);
  });

  it('rejects state + states[] — two labeling mechanisms (P6)', async () => {
    const { status, data } = await caught(api.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [LINE_ROLE] },
      groupBy: { state: true },
      states: [{ name: 'x', match: {} }],
      measure: { kind: 'dwell', window: { from: windowFrom, to: windowTo } },
    }));
    expect(status).toBe(400);
    expect(data.error).toContain('two labeling mechanisms');
  });
});
