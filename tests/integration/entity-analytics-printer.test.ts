/**
 * The canonical printer scenario — the acceptance vehicle for entity
 * analytics. A fresh seeded install answers Q1 (the fleet), Q2 (the slice),
 * and Q3 (the individual) with the literal one-liner calls, and the terminal
 * history scan is served by the partial ended_at index (D2).
 *
 * Requires: docker compose up -d --build (the flagship seed runs at startup)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient, log, poll, pgQuery } from './helpers';

const FLEET = 'printer-fleet';
const HARVEST = 'printer-harvest';
const SERVICE = 'printer-service';
const CANONICAL_STATES = ['idle', 'printing', HARVEST, SERVICE];

let api: ApiClient;

const window7h = () => ({
  from: new Date(Date.now() - 7 * 3_600_000).toISOString(),
  to: new Date(Date.now() + 60_000).toISOString(),
});

beforeAll(async () => {
  api = new ApiClient();
  await api.login('superadmin', 'l0ngt@1l');
  // The seeder runs asynchronously after boot — wait for the fleet.
  await poll('printer fleet seeded', async () => {
    const { data } = await api.get('/api/escalations', {
      role: FLEET, status: 'pending', limit: '1',
    });
    return data.escalations?.length ? true : null;
  }, 120_000);
  log('setup', 'flagship printer seed present');
}, 180_000);

describe('the seeded roles (S1/S2)', () => {
  it('declares both dials on all three roles', async () => {
    const { data } = await api.get('/api/roles/details');
    const byRole = new Map(data.roles.map((r: any) => [r.role, r]));
    for (const role of [FLEET, HARVEST, SERVICE]) {
      expect((byRole.get(role) as any)?.entity_facet).toBe('serialNumber');
    }
    expect((byRole.get(FLEET) as any).entity_state_source).toBe('subtype');
    expect((byRole.get(HARVEST) as any).entity_state_source).toBe('role');
    expect((byRole.get(SERVICE) as any).entity_state_source).toBe('role');
  });
});

describe('Q1 — how did the fleet spend its time', () => {
  it('is one call: entity + state + dwell, returning exactly the four states', async () => {
    const { data } = await api.post('/api/escalations/aggregate-by-facets', {
      query: { entity: 'serialNumber' },
      groupBy: { state: true },
      measure: { kind: 'dwell', window: window7h() },
    });
    const states = data.groups.map((g: any) => g.state).sort();
    expect(states).toEqual([...CANONICAL_STATES].sort());
    for (const g of data.groups) expect(g.dwellSeconds).toBeGreaterThan(0);
  });

  it('counts printers, not rows, right now (P4)', async () => {
    const { data } = await api.post('/api/escalations/aggregate-by-facets', {
      query: { entity: 'serialNumber' },
      groupBy: {},
      measure: { kind: 'membership' },
      distinctBy: 'serialNumber',
    });
    expect(data.groups[0].count).toBe(6); // one live interval per seeded printer
  });
});

describe('Q2 — the slice', () => {
  it('is Q1 plus groupBy.facets: model — p1s and h2s carry independent splits', async () => {
    const { data } = await api.post('/api/escalations/aggregate-by-facets', {
      query: { entity: 'serialNumber' },
      groupBy: { state: true, facets: ['model'] },
      measure: { kind: 'dwell', window: window7h() },
    });
    const models = new Set(data.groups.map((g: any) => g.facets.model));
    expect(models).toEqual(new Set(['p1s', 'h2s']));
    const p1s = data.groups.filter((g: any) => g.facets.model === 'p1s');
    const h2s = data.groups.filter((g: any) => g.facets.model === 'h2s');
    expect(p1s.length).toBeGreaterThan(1);
    expect(h2s.length).toBeGreaterThan(1);
    const dwellOf = (rows: any[], state: string) =>
      rows.find((g) => g.state === state)?.dwellSeconds ?? 0;
    expect(dwellOf(p1s, 'printing')).not.toBe(dwellOf(h2s, 'printing'));
  });
});

describe('Q3 — the individual', () => {
  it('returns one printer\'s whole journey with durations and an explicit gap', async () => {
    const { data } = await api.post('/api/escalations/timeline-by-facet', {
      facet: { key: 'serialNumber', value: 'PRN-001' },
      query: { entity: 'serialNumber' },
    });
    const intervals = data.intervals;
    expect(intervals.length).toBeGreaterThan(3);

    // created_at order, spanning more than one queue.
    const starts = intervals.map((i: any) => Date.parse(i.startedAt));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(new Set(intervals.map((i: any) => i.role)).size).toBeGreaterThan(1);

    // Exactly one open interval — the printer's live state — at the end.
    expect(intervals.filter((i: any) => i.endedAt === null)).toHaveLength(1);
    expect(intervals[intervals.length - 1].endedAt).toBeNull();

    // The seeded settle gaps are preserved as untracked time.
    const gaps = intervals.slice(1).map((iv: any, i: number) =>
      Date.parse(iv.startedAt) - Date.parse(intervals[i].endedAt));
    expect(Math.max(...gaps)).toBeGreaterThan(60_000);
  });
});

describe('D2 — the terminal scan is index-bounded', () => {
  it('EXPLAIN shows idx_hmsh_esc_ended_at serving the terminal branch', async () => {
    // The seeded table is small enough that the planner may prefer a seq scan
    // on cost alone; disabling it proves the partial index MATCHES the
    // predicate — the property that keeps the scan bounded as history grows.
    const rows = await pgQuery(`
      SET enable_seqscan = off;
      EXPLAIN (FORMAT TEXT)
      SELECT count(*) FROM public.hmsh_escalations
      WHERE status NOT IN ('pending')
        AND COALESCE(resolved_at, updated_at) > NOW() - interval '1 hour'
    `);
    const plan = rows.map((r: any) => r['QUERY PLAN']).join('\n');
    expect(plan).toContain('idx_hmsh_esc_ended_at');
  });
});
