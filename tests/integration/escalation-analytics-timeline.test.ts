/**
 * Escalation analytics — the per-entity timeline (P7).
 *
 * One entity's intervals in created_at order: durations from the stored
 * timestamps, open rows with endedAt null, and the untracked time between
 * queues PRESERVED — the settle gap is a first-class signal, never filled.
 *
 * Requires: docker compose up -d --build
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient, log, pgQuery } from './helpers';

const STAGE_ROLE = 'analytics-tl-stage';
const FINISH_ROLE = 'analytics-tl-finish';
const SERIAL = `SER-TL-${Date.now()}`;

let api: ApiClient;

async function step(role: string, subtype: string, holdMs: number, resolve: boolean): Promise<void> {
  const { data } = await api.post('/api/escalations', {
    type: 'analytics-fixture',
    subtype,
    role,
    metadata: { unitSerial: SERIAL },
  });
  await new Promise((r) => setTimeout(r, holdMs));
  if (resolve) {
    await api.post(`/api/escalations/${data.id}/resolve`, { resolverPayload: {} });
    // The settle gap between queues — untracked time the timeline must expose.
    await new Promise((r) => setTimeout(r, 1_200));
  }
}

beforeAll(async () => {
  api = new ApiClient();
  await api.login('superadmin', 'l0ngt@1l');
  for (const role of [STAGE_ROLE, FINISH_ROLE]) {
    await api.post('/api/roles', { role }).catch(() => { /* exists */ });
    await api.patch(`/api/roles/${role}`, { entity_facet: 'unitSerial' });
  }
  // The journey: stage(closed) → gap → stage(closed) → gap → finish(open).
  await step(STAGE_ROLE, 'waiting', 1_000, true);
  await step(STAGE_ROLE, 'working', 1_000, true);
  await step(FINISH_ROLE, 'finish', 0, false);
  log('setup', `journey seeded for ${SERIAL}`);
}, 120_000);

describe('timelineByFacet', () => {
  it('returns the whole journey in created_at order with exact durations and gaps', async () => {
    const { data } = await api.post('/api/escalations/timeline-by-facet', {
      facet: { key: 'unitSerial', value: SERIAL },
      query: { entity: 'unitSerial' },
    });
    const intervals = data.intervals;
    expect(intervals).toHaveLength(3);
    expect(intervals.map((i: any) => i.subtype)).toEqual(['waiting', 'working', 'finish']);
    expect(intervals.map((i: any) => i.role)).toEqual([STAGE_ROLE, STAGE_ROLE, FINISH_ROLE]);

    // Durations agree with the stored interval to the second.
    const rows = await pgQuery(
      `SELECT subtype, created_at, ended_at FROM public.lt_escalations
       WHERE metadata->>'unitSerial' = $1 ORDER BY created_at ASC`,
      [SERIAL],
    );
    for (let i = 0; i < 2; i++) {
      const expected = (new Date(rows[i].ended_at).getTime() - new Date(rows[i].created_at).getTime()) / 1000;
      expect(intervals[i].endedAt).not.toBeNull();
      expect(intervals[i].durationSeconds).toBeCloseTo(expected, 1);
    }

    // The open interval reports endedAt null and accrues to now.
    expect(intervals[2].endedAt).toBeNull();
    expect(intervals[2].durationSeconds).toBeGreaterThan(0);

    // The settle gaps are PRESERVED: each next interval starts after the prior end.
    for (let i = 1; i < intervals.length; i++) {
      const gapMs = Date.parse(intervals[i].startedAt) - Date.parse(intervals[i - 1].endedAt);
      expect(gapMs).toBeGreaterThan(1_000);
    }
  });

  it('a window overlap-filters intervals without clipping their reported spans', async () => {
    const rows = await pgQuery(
      `SELECT created_at FROM public.lt_escalations
       WHERE metadata->>'unitSerial' = $1 ORDER BY created_at ASC`,
      [SERIAL],
    );
    // A window opening after the first interval ended excludes only it.
    const from = new Date(new Date(rows[1].created_at).getTime() - 100).toISOString();
    const { data } = await api.post('/api/escalations/timeline-by-facet', {
      facet: { key: 'unitSerial', value: SERIAL },
      window: { from, to: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(data.intervals.map((i: any) => i.subtype)).toEqual(['working', 'finish']);
  });

  it('desc + before pages walk the whole history and equal the asc journey reversed', async () => {
    const { data: asc } = await api.post('/api/escalations/timeline-by-facet', {
      facet: { key: 'unitSerial', value: SERIAL },
    });
    const expected = asc.intervals.map((i: any) => i.startedAt).reverse();

    // Page recent-first, one interval at a time, cursoring on the oldest loaded.
    const walked: string[] = [];
    let before: string | undefined;
    for (let hop = 0; hop < 10; hop++) {
      const { data: page } = await api.post('/api/escalations/timeline-by-facet', {
        facet: { key: 'unitSerial', value: SERIAL },
        order: 'desc',
        limit: 1,
        ...(before ? { before } : {}),
      });
      if (page.intervals.length === 0) break;
      walked.push(...page.intervals.map((i: any) => i.startedAt));
      before = page.intervals[page.intervals.length - 1].startedAt;
      if (!page.overflow) break;
    }
    expect(walked).toEqual(expected);
  });

  it('select.facets projects extra metadata per interval', async () => {
    const { data } = await api.post('/api/escalations/timeline-by-facet', {
      facet: { key: 'unitSerial', value: SERIAL },
      select: { columns: ['role'], facets: ['unitSerial'] },
      limit: 2,
    });
    expect(data.intervals[0].facets.unitSerial).toBe(SERIAL);
    expect(data.intervals[0].subtype).toBeUndefined();
    expect(data.overflow).toBe(true); // 3 intervals, limit 2
  });
});
