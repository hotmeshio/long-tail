/**
 * The station flow, end to end against the seeded demo: a shared device
 * signed in as the read-only station account scans an item, sees choices
 * with the mutating ones withheld, badges in, and acts — with the mutation
 * attributed to the badged person and the device recorded beside it.
 *
 * Requires: docker compose up -d --build (flagship printer seed + scheme 10/11)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient, log, poll } from './helpers';

const OBJECT_SCAN = '10:4:PRN-006'; // scheme 10, category 4 (Work Item), a seeded printer
const BADGE_SCAN = '11:0:BADGE-REVIEWER-7431'; // the seeded associate badge

let station: ApiClient;
let admin: ApiClient;
let reviewerId: string;
let stationId: string;

beforeAll(async () => {
  admin = new ApiClient();
  await admin.login('superadmin', 'l0ngt@1l');
  station = new ApiClient();
  await station.login('station', 'l0ngt@1l');

  const { data: users } = await admin.get('/api/users');
  reviewerId = users.users.find((u: any) => u.external_id === 'reviewer').id;
  stationId = users.users.find((u: any) => u.external_id === 'station').id;

  // The flagship seed runs asynchronously after boot and creates the fleet
  // printer by printer — the scans below target specific serials, so wait for
  // ALL SIX live intervals, not just the first row.
  await poll('printer fleet fully seeded', async () => {
    const { data } = await admin.post('/api/escalations/aggregate-by-facets', {
      query: { entity: 'serialNumber' },
      groupBy: {},
      measure: { kind: 'membership' },
      distinctBy: 'serialNumber',
    }).catch(() => ({ data: { groups: [] } })); // dials not declared yet → 400 → keep polling
    return (data.groups?.[0]?.count ?? 0) >= 6 ? true : null;
    // The flagship seed is ~100 engine calls behind every other seeder — a
    // cold multi-container boot can take a few minutes to finish it.
  }, 240_000);
  log('setup', 'station + associate ready');
}, 300_000);

describe('the read-only station', () => {
  it('an object scan presents reality with mutating choices withheld', async () => {
    const { data } = await station.post('/api/scan-codes/execute', { code: OBJECT_SCAN });
    expect(data.outcome).toBe('choices');
    expect(data.escalation.metadata.serialNumber).toBe('PRN-006');

    const byLabel = new Map(data.choices.map((c: any) => [c.label, c]));
    expect((byLabel.get('Claim & Start') as any).withheld).toBe(true);
    expect((byLabel.get('View Details') as any).withheld).toBe(false);
    expect(data.notPrimed.markdown).toContain('Scan your badge');
  });

  it('forcing a withheld choice without a badge is NOT_PRIMED, never a station-owned claim', async () => {
    const { data: presented } = await station.post('/api/scan-codes/execute', { code: OBJECT_SCAN });
    const claim = presented.choices.find((c: any) => c.label === 'Claim & Start');
    const { data } = await station.post('/api/scan-codes/execute-choice', {
      schemeVersion: 10, category: '4', stepIndex: presented.stepIndex,
      choiceIndex: claim.index, escalationId: presented.escalation.id,
    });
    expect(data.outcome).toBe('not_primed');
  });
});

describe('the badge layer', () => {
  let actingToken: string;
  let escalationId: string;
  let stepIndex: number;
  let claimIndex: number;

  it('a badge scan mints an acting grant', async () => {
    const { data } = await station.post('/api/scan-codes/execute', { code: BADGE_SCAN });
    expect(data.outcome).toBe('identity_primed');
    expect(data.actor.displayName).toBe('Reviewer User');
    expect(data.actingToken).toMatch(/^eph:v1:acting_identity:/);
    expect(data.expiresAt).toBeDefined();
    actingToken = data.actingToken;
  });

  it('an unknown badge is IDENTITY_UNKNOWN with the configured screen', async () => {
    const { data } = await station.post('/api/scan-codes/execute', { code: '11:0:BADGE-NOBODY' });
    expect(data.outcome).toBe('identity_unknown');
    expect(data.fallback.markdown).toContain('Badge not recognized');
  });

  it('a primed object scan enables the withheld choices', async () => {
    const { data } = await station.post('/api/scan-codes/execute', {
      code: OBJECT_SCAN, actingToken,
    });
    expect(data.outcome).toBe('choices');
    const claim = data.choices.find((c: any) => c.label === 'Claim & Start');
    expect(claim.withheld).toBe(false);
    escalationId = data.escalation.id;
    stepIndex = data.stepIndex;
    claimIndex = claim.index;
  });

  it('the claim attributes to the badged person, with the station recorded beside it', async () => {
    const { data } = await station.post('/api/scan-codes/execute-choice', {
      schemeVersion: 10, category: '4', stepIndex, choiceIndex: claimIndex,
      escalationId, actingToken,
    });
    expect(data.outcome).toBe('executed');

    const { data: row } = await admin.get(`/api/escalations/${escalationId}`);
    expect(row.assigned_to).toBe(reviewerId);        // the person, never the station
    expect(row.metadata.scanStation).toBe(stationId); // the device, on the audit pair
    expect(row.metadata.scanActionName).toBe('Work Item');
  });

  it('continuity: the work surface honors the grant — resolve rides the header as the person', async () => {
    // The badged person claimed by scan; now they submit from the escalation
    // detail page. The station session sends the grant as a header and the
    // resolve attributes to the person, exactly like a self-claim.
    station.setHeader('x-lt-acting-token', actingToken);
    try {
      const { data } = await station.post(`/api/escalations/${escalationId}/resolve`, {
        resolverPayload: { outcome: 'complete', detail: 'submitted at the station' },
      });
      expect(data.acknowledged).toBe(true);
    } finally {
      station.clearHeader('x-lt-acting-token');
    }

    const { data: row } = await admin.get(`/api/escalations/${escalationId}`);
    expect(row.status).toBe('resolved');
    expect(row.metadata.resolved_by).toBe(reviewerId);
  });

  it('a dead grant on the work surface is a loud 401, never a station-owned mutation', async () => {
    station.setHeader('x-lt-acting-token', 'eph:v1:acting_identity:00000000-0000-4000-8000-000000000000');
    try {
      const result = await station.post(`/api/escalations/${escalationId}/resolve`, {
        resolverPayload: { outcome: 'complete' },
      }).catch((err: any) => {
        const match = err.message.match(/→ (\d+): (.+)/);
        return { status: parseInt(match[1], 10), data: JSON.parse(match[2]) };
      });
      expect(result.status).toBe(401);
      expect(result.data.error).toContain('scan your badge');
    } finally {
      station.clearHeader('x-lt-acting-token');
    }
  });

  it('a replaced grant dies immediately — the next badge revokes it', async () => {
    const { data: primed } = await station.post('/api/scan-codes/execute', {
      code: BADGE_SCAN, previousActingToken: actingToken,
    });
    expect(primed.outcome).toBe('identity_primed');

    const { data } = await station.post('/api/scan-codes/execute', {
      code: OBJECT_SCAN, actingToken, // the revoked grant
    });
    expect(data.outcome).toBe('not_primed');
    expect(data.error).toContain('scan your badge');
  });

  it('auto-select: an unprimed scan stops over; a primed scan is one action', async () => {
    // Category 5 (Claim & Work) holds a single auto-selecting claim choice.
    const unprimed = await station.post('/api/scan-codes/execute', { code: '10:5:PRN-001' });
    expect(unprimed.data.outcome).toBe('choices');
    expect(unprimed.data.autoSelect).toBe(true); // would have executed — identity stopped it
    expect(unprimed.data.choices[0].withheld).toBe(true);

    const { data: primed } = await station.post('/api/scan-codes/execute', { code: BADGE_SCAN });
    const { data } = await station.post('/api/scan-codes/execute', {
      code: '10:5:PRN-001', actingToken: primed.actingToken,
    });
    expect(data.outcome).toBe('executed');
    expect(data.verb).toBe('claim-show-detail');

    const { data: row } = await admin.get(`/api/escalations/${data.escalation.id}`);
    expect(row.assigned_to).toBe(reviewerId);
    expect(row.metadata.scanStation).toBe(stationId);
  });

  it('a write-incapable badged user is FORBIDDEN — the grant confers attribution, not privilege', async () => {
    // A person who can READ the floor but holds no write scope there: their
    // badge primes the session (the identity gate passes — a real person is
    // acting), but their OWN RBAC denies the mutation.
    const { data: users } = await admin.get('/api/users');
    const engineer = users.users.find((u: any) => u.external_id === 'engineer');
    await admin.put(`/api/users/${engineer.id}`, { metadata: { badge_id: 'BADGE-ENGINEER-0001' } });
    for (const role of ['printer-fleet', 'printer-harvest', 'printer-service']) {
      await admin.post(`/api/users/${engineer.id}/roles`, {
        role, type: 'member', read_scope: 'all', write_scope: 'none',
      }).catch(() => { /* already granted on re-runs */ });
    }

    const { data: primed } = await station.post('/api/scan-codes/execute', { code: '11:0:BADGE-ENGINEER-0001' });
    expect(primed.outcome).toBe('identity_primed');

    // A different printer — its live row is still unclaimed, so the denial
    // below is purely the write gate, never a claim conflict.
    const { data: presented } = await station.post('/api/scan-codes/execute', {
      code: '10:4:PRN-005', actingToken: primed.actingToken,
    });
    expect(presented.outcome).toBe('choices');
    const claim = presented.choices.find((c: any) => c.label === 'Claim & Start');
    const { data } = await station.post('/api/scan-codes/execute-choice', {
      schemeVersion: 10, category: '4', stepIndex: presented.stepIndex,
      choiceIndex: claim.index, escalationId: presented.escalation.id,
      actingToken: primed.actingToken,
    });
    expect(data.outcome).toBe('forbidden');
  });
});
