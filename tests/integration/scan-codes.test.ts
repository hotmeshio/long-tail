/**
 * Scan codes — integration test through the public routes.
 *
 * A scan code (version:category:target) resolves the target against a
 * scheme's metadata facet, walks the rule's condition/action steps, and
 * returns a structured outcome. Covers: admin CRUD, per-verb golden paths,
 * step fallthrough, confirm two-phase, fallback, RBAC, and concurrent
 * double-scan serialization.
 *
 * Requires: docker compose up -d --build (app + Postgres)
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { ApiClient, log } from './helpers';

const PASSWORD = 'l0ngt@1l';
const VERSION = 8; // clear of seeded demo schemes
const QUEUE = 'scan-case-queue';
const SERVICE_QUEUE = 'scan-case-service';
const FACET = 'assetTag';

let admin: ApiClient;
let reviewer: ApiClient;

/** Per-run tag suffix — the suite stays idempotent across repeated runs. */
const RUN = Date.now().toString(36);
const tag = (label: string) => `${label}-${RUN}`;

/** Create a pending escalation carrying the target facet. */
async function seedEscalation(tag: string, extra: Record<string, any> = {}) {
  const { status, data } = await admin.post('/api/escalations', {
    type: 'scan-case',
    role: QUEUE,
    description: `scan case ${tag}`,
    metadata: { [FACET]: tag, ...extra },
  });
  expect(status).toBe(201);
  return data;
}

async function putRule(category: string, body: Record<string, any>) {
  const { status } = await admin.put(
    `/api/scan-codes/schemes/${VERSION}/actions/${category}`,
    body,
  );
  expect(status).toBe(200);
}

async function scan(code: string, client: ApiClient = admin) {
  const { status, data } = await client.post('/api/scan-codes/execute', { code });
  expect(status).toBe(200);
  return data;
}

beforeAll(async () => {
  admin = new ApiClient();
  await admin.login('superadmin', PASSWORD);
  reviewer = new ApiClient();
  await reviewer.login('reviewer', PASSWORD);

  // lt_escalations.role is an FK — the case queues must exist first.
  // Role creation is idempotent (ON CONFLICT DO NOTHING); the client throws
  // on any non-2xx, so reaching the next line is the assertion.
  for (const role of [QUEUE, SERVICE_QUEUE]) {
    await admin.post('/api/roles', { role });
  }

  const { status } = await admin.put(`/api/scan-codes/schemes/${VERSION}`, {
    name: 'integration-case',
    target_facet: FACET,
    encoding: 'delimited',
    delimiter: ':',
  });
  expect(status).toBe(200);
  log('setup', `scheme ${VERSION} ready`);
}, 120_000);

describe('scheme and rule CRUD', () => {
  it('round-trips a scheme', async () => {
    const { status, data } = await admin.get(`/api/scan-codes/schemes/${VERSION}`);
    expect(status).toBe(200);
    expect(data.scheme.target_facet).toBe(FACET);
  });

  it('rejects an incoherent rule with 400', async () => {
    // The client throws on non-2xx; the write-time invariant is the message.
    await expect(admin.put(
      `/api/scan-codes/schemes/${VERSION}/actions/99`,
      { name: 'broken', steps: [{ query: {}, verb: 'escalate' }] },
    )).rejects.toThrow(/400.*targetRole/);
  });

  it('denies rule writes to plain members', async () => {
    await expect(reviewer.put(
      `/api/scan-codes/schemes/${VERSION}/actions/98`,
      { name: 'nope', steps: [{ query: {}, verb: 'show-detail' }] },
    )).rejects.toThrow(/403/);
  });

  it('engineers can write rules (role-manager gate)', async () => {
    const engineer = new ApiClient();
    await engineer.login('engineer', PASSWORD);
    const { status } = await engineer.put(
      `/api/scan-codes/schemes/${VERSION}/actions/97`,
      { name: 'engineer-case', steps: [{ query: {}, verb: 'show-detail' }] },
    );
    expect(status).toBe(200);
    await engineer.delete(`/api/scan-codes/schemes/${VERSION}/actions/97`);
  });
});

describe('execute — parse outcomes', () => {
  it('reports invalid_code for a malformed string', async () => {
    const data = await scan(`${VERSION}:1:oops`);
    expect(data.outcome).toBe('invalid_code');
  });

  it('reports unconfigured for an unknown version', async () => {
    const data = await scan('7:01:whatever');
    expect(data.outcome).toBe('unconfigured');
  });

  it('reports unconfigured for an unknown category', async () => {
    const data = await scan(`${VERSION}:77:whatever`);
    expect(data.outcome).toBe('unconfigured');
  });
});

describe('execute — verbs', () => {
  it('show-detail locates the escalation (scan as query)', async () => {
    await putRule('01', {
      name: 'Where is it',
      steps: [{ query: { roles: [QUEUE] }, verb: 'show-detail' }],
      fallback: { markdown: 'Nothing found.' },
    });
    const created = await seedEscalation(tag('TAG-SHOW'));
    const data = await scan(`${VERSION}:01:${tag('TAG-SHOW')}`);
    expect(data.outcome).toBe('executed');
    expect(data.verb).toBe('show-detail');
    expect(data.escalation.id).toBe(created.id);
    expect(data.rule.name).toBe('Where is it');
    expect(data.stepIndex).toBe(0);
  });

  it('falls back when nothing matches', async () => {
    const data = await scan(`${VERSION}:01:${tag('TAG-MISSING')}`);
    expect(data.outcome).toBe('no_match_fallback');
    expect(data.fallback.markdown).toBe('Nothing found.');
  });

  it('claim assigns the row and stamps provenance', async () => {
    await putRule('02', {
      name: 'Claim it',
      steps: [{ query: { roles: [QUEUE] }, verb: 'claim-show-detail' }],
    });
    await seedEscalation(tag('TAG-CLAIM'));
    const data = await scan(`${VERSION}:02:${tag('TAG-CLAIM')}`);
    expect(data.outcome).toBe('executed');
    expect(data.escalation.assigned_to).toBeTruthy();
    expect(data.escalation.metadata.scanActionName).toBe('Claim it');
    expect(data.escalation.metadata.scanCategory).toBe('02');
  });

  it('resolve closes the row with the interpolated payload', async () => {
    await putRule('03', {
      name: 'Print failed',
      steps: [{
        query: { roles: [QUEUE] },
        verb: 'resolve',
        params: { resolverPayload: { outcome: 'fail', tag: '{scan.target}' } },
      }],
    });
    const created = await seedEscalation(tag('TAG-RESOLVE'));
    const data = await scan(`${VERSION}:03:${tag('TAG-RESOLVE')}`);
    expect(data.outcome).toBe('executed');
    const { data: after } = await admin.get(`/api/escalations/${created.id}`);
    expect(after.status).toBe('resolved');
    expect(JSON.parse(after.resolver_payload)).toMatchObject({ outcome: 'fail', tag: tag('TAG-RESOLVE') });
  });

  it('escalate closes the current row and creates one in the target queue', async () => {
    await putRule('04', {
      name: 'Send to servicing',
      steps: [{
        query: { roles: [QUEUE] },
        verb: 'escalate',
        params: {
          targetRole: SERVICE_QUEUE,
          closeCurrent: 'resolve',
          resolverPayload: { outcome: 'sent-to-service' },
          metadata: { serviceReason: 'scan {scan.category}' },
        },
      }],
    });
    const created = await seedEscalation(tag('TAG-ESCALATE'));
    const data = await scan(`${VERSION}:04:${tag('TAG-ESCALATE')}`);
    expect(data.outcome).toBe('executed');
    expect(data.verb).toBe('escalate');
    // the located row closed…
    const { data: closed } = await admin.get(`/api/escalations/${created.id}`);
    expect(closed.status).toBe('resolved');
    // …and the twin re-homed in the service queue, findable by the same tag
    expect(data.escalation.role).toBe(SERVICE_QUEUE);
    expect(data.escalation.metadata[FACET]).toBe(tag('TAG-ESCALATE'));
    expect(data.escalation.metadata.serviceReason).toBe('scan 04');
    expect(data.escalation.status).toBe('pending');
  });

  it('cancel locks then cancels', async () => {
    await putRule('05', {
      name: 'Cancel it',
      steps: [{ query: { roles: [QUEUE] }, verb: 'cancel' }],
    });
    const created = await seedEscalation(tag('TAG-CANCEL'));
    const data = await scan(`${VERSION}:05:${tag('TAG-CANCEL')}`);
    expect(data.outcome).toBe('executed');
    const { data: after } = await admin.get(`/api/escalations/${created.id}`);
    expect(after.status).toBe('cancelled');
  });
});

describe('execute — step semantics', () => {
  it('falls through a guarded step to the broader locator', async () => {
    await putRule('06', {
      name: 'Collect from harvest',
      steps: [
        {
          query: { roles: ['some-other-queue'] },
          verb: 'resolve',
          params: { resolverPayload: { collected: true } },
        },
        { query: {}, verb: 'show-detail' },
      ],
    });
    const created = await seedEscalation(tag('TAG-FALLTHROUGH'));
    const data = await scan(`${VERSION}:06:${tag('TAG-FALLTHROUGH')}`);
    // step 1 targets a queue the item is not in → step 2 reports where it IS
    expect(data.outcome).toBe('executed');
    expect(data.stepIndex).toBe(1);
    expect(data.escalation.id).toBe(created.id);
    const { data: after } = await admin.get(`/api/escalations/${created.id}`);
    expect(after.status).toBe('pending');
  });

  it('confirm locates without mutating and returns the pending action', async () => {
    await putRule('07', {
      name: 'Cancel with confirmation',
      steps: [{
        query: { roles: [QUEUE] },
        verb: 'cancel',
        confirm: { prompt: 'Are you sure you want to cancel?' },
      }],
    });
    const created = await seedEscalation(tag('TAG-CONFIRM'));
    const data = await scan(`${VERSION}:07:${tag('TAG-CONFIRM')}`);
    expect(data.outcome).toBe('confirm_required');
    expect(data.pendingAction.escalationId).toBe(created.id);
    expect(data.pendingAction.verb).toBe('cancel');
    expect(data.pendingAction.prompt).toBe('Are you sure you want to cancel?');
    // nothing mutated
    const { data: after } = await admin.get(`/api/escalations/${created.id}`);
    expect(after.status).toBe('pending');
    expect(after.assigned_to).toBeNull();
  });

  it('show-list returns the match set and the list query', async () => {
    await putRule('09', {
      name: 'Show all with tag',
      steps: [{ query: { roles: [QUEUE] }, cardinality: 'many', verb: 'show-list' }],
    });
    await seedEscalation(tag('TAG-LIST'));
    await seedEscalation(tag('TAG-LIST'));
    const data = await scan(`${VERSION}:09:${tag('TAG-LIST')}`);
    expect(data.outcome).toBe('matched_list');
    expect(data.escalations.length).toBe(2);
    expect(data.listQuery.targetFacet).toBe(FACET);
    expect(data.listQuery.target).toBe(tag('TAG-LIST'));
  });

  it('serializes a concurrent double-scan to one winner', async () => {
    await seedEscalation(tag('TAG-RACE'));
    const code = `${VERSION}:05:${tag('TAG-RACE')}`; // cancel rule
    const [a, b] = await Promise.all([scan(code), scan(code)]);
    const outcomes = [a.outcome, b.outcome].sort();
    // exactly one cancel executes; the loser either finds nothing pending
    // (fallback/conflict) or extends the winner's claim then fails the cancel
    expect(outcomes.filter((o) => o === 'executed')).toHaveLength(1);
  });
});

describe('execute — RBAC', () => {
  it('a caller without write access cannot mutate through a scan', async () => {
    await seedEscalation(tag('TAG-RBAC'));
    const data = await scan(`${VERSION}:05:${tag('TAG-RBAC')}`, reviewer); // cancel rule
    // reviewer has no membership in the scan-case queue: the atomic filter
    // matches nothing they may act on — never a partial write
    expect(['forbidden', 'no_match_fallback']).toContain(data.outcome);
    const list = await admin.get('/api/escalations', { role: QUEUE, status: 'pending', search: '' });
    expect(list.status).toBe(200);
  });
});
