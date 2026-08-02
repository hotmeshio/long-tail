/**
 * Escalation analytics — the read gate (P8), through real logins.
 *
 * read_all on EVERY role in scope; a roleless query needs a global principal;
 * entity scope gates the derived system's roles; timelines always take the
 * full gate. The compose stack keeps publicPaceBoard on (the default), so the
 * counts-only carve-out is asserted positively and the strict gate is
 * exercised through facet-keyed groupings, which always take it.
 *
 * Requires: docker compose up -d --build
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient, log } from './helpers';

const ROLE_IN = 'analytics-auth-in';   // the operator holds read_all here
const ROLE_OUT = 'analytics-auth-out'; // ...and only read_self here
const STAMP = Date.now();

let admin: ApiClient;
let operator: ApiClient;

function caught(promise: Promise<any>): Promise<{ status: number; data: any }> {
  return promise.catch((err: any) => {
    const match = err.message.match(/→ (\d+): (.+)/);
    return { status: parseInt(match[1], 10), data: JSON.parse(match[2]) };
  });
}

// The compose stack runs with publicPaceBoard on (the default), so counts-only
// groupings are readable by any login — the strict gate is exercised through
// facet-KEYED groupings, which always take it (facet values are entity ids).
const MEMBERSHIP = { groupBy: {}, measure: { kind: 'membership' } };
const FACET_KEYED = { groupBy: { facets: ['unitSerial'] }, measure: { kind: 'membership' } };

beforeAll(async () => {
  admin = new ApiClient();
  await admin.login('superadmin', 'l0ngt@1l');
  for (const role of [ROLE_IN, ROLE_OUT]) {
    await admin.post('/api/roles', { role }).catch(() => { /* exists */ });
    await admin.patch(`/api/roles/${role}`, { entity_facet: 'unitSerial' });
  }
  await admin.post('/api/users', {
    external_id: `analytics-operator-${STAMP}`,
    display_name: 'Analytics Operator',
    password: 'analytics-op-pass',
    roles: [
      { role: ROLE_IN, type: 'member', read_scope: 'all', write_scope: 'all' },
      { role: ROLE_OUT, type: 'member', read_scope: 'self', write_scope: 'self' },
    ],
  });
  operator = new ApiClient();
  await operator.login(`analytics-operator-${STAMP}`, 'analytics-op-pass');
  log('setup', 'scoped operator provisioned');
}, 120_000);

describe('aggregate gate', () => {
  it('read_all on the requested role passes', async () => {
    const { status } = await operator.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [ROLE_IN] },
      ...MEMBERSHIP,
    });
    expect(status).toBe(200);
  });

  it('counts-only groupings are board-public — the station-metrics data class', async () => {
    const { status } = await operator.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [ROLE_IN, ROLE_OUT] },
      ...MEMBERSHIP,
    });
    expect(status).toBe(200);
  });

  it('facet-keyed groupings: read_self on any requested role fails the whole query', async () => {
    const { status, data } = await caught(operator.post('/api/escalations/aggregate-by-facets', {
      query: { roles: [ROLE_IN, ROLE_OUT] },
      ...FACET_KEYED,
    }));
    expect(status).toBe(403);
    expect(data.error).toContain('read_all');
  });

  it('a roleless facet-keyed query requires a global principal', async () => {
    const denied = await caught(operator.post('/api/escalations/aggregate-by-facets', {
      query: {},
      ...FACET_KEYED,
    }));
    expect(denied.status).toBe(403);

    const allowed = await admin.post('/api/escalations/aggregate-by-facets', {
      query: {},
      ...FACET_KEYED,
    });
    expect(allowed.status).toBe(200);
  });

  it('entity scope gates the DERIVED system — a read_self role inside it denies', async () => {
    // unitSerial's system includes ROLE_OUT (declared in setup), where the
    // operator holds only read_self.
    const { status, data } = await caught(operator.post('/api/escalations/aggregate-by-facets', {
      query: { entity: 'unitSerial' },
      groupBy: { state: true, facets: ['unitSerial'] },
      measure: { kind: 'membership' },
    }));
    expect(status).toBe(403);
    expect(data.error).toContain(ROLE_OUT);
  });
});

describe('dial PATCH semantics (D3)', () => {
  it('updating one dial preserves the other', async () => {
    await admin.patch(`/api/roles/${ROLE_IN}`, { entity_state_source: 'subtype' });
    const { data } = await admin.get('/api/roles/details');
    const row = data.roles.find((r: any) => r.role === ROLE_IN);
    expect(row.entity_state_source).toBe('subtype');
    expect(row.entity_facet).toBe('unitSerial'); // untouched by the PATCH
  });

  it('rejects a malformed dial with a loud 400', async () => {
    const badKey = await caught(admin.patch(`/api/roles/${ROLE_IN}`, { entity_facet: 'metadata.serial' }));
    expect(badKey.status).toBe(400);
    const badSource = await caught(admin.patch(`/api/roles/${ROLE_IN}`, { entity_state_source: 'queue' }));
    expect(badSource.status).toBe(400);
  });
});

describe('timeline gate', () => {
  it('takes the full gate — read_all on the scoped role passes, read_self fails', async () => {
    const allowed = await operator.post('/api/escalations/timeline-by-facet', {
      facet: { key: 'unitSerial', value: 'SER-AUTH-1' },
      query: { roles: [ROLE_IN] },
    });
    expect(allowed.status).toBe(200);

    const denied = await caught(operator.post('/api/escalations/timeline-by-facet', {
      facet: { key: 'unitSerial', value: 'SER-AUTH-1' },
      query: { roles: [ROLE_OUT] },
    }));
    expect(denied.status).toBe(403);
  });

  it('a roleless timeline spans every queue and requires a global principal', async () => {
    const denied = await caught(operator.post('/api/escalations/timeline-by-facet', {
      facet: { key: 'unitSerial', value: 'SER-AUTH-1' },
    }));
    expect(denied.status).toBe(403);
  });
});
