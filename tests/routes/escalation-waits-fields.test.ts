import { describe, it, expect, afterAll } from 'vitest';

import { setupRouteTest, authHeaders } from './setup';
import { getPool } from '../../lib/db';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

// The waits route stores the form envelope, assignment and lineage on the
// row, in the columns HotMesh's conditional() writes.
const ctx = setupRouteTest(4672, { durable: { provider: new FakeDurableProvider('route-wait-fields') } } as any);

const RUN = `route-wait-fields-${Date.now()}`;
const ASSIGNEE = '00000000-0000-4000-8000-0000000000aa';

async function openWait(workflowId: string, body: Record<string, unknown>) {
  const res = await fetch(`${ctx.BASE}/escalations/waits`, {
    method: 'POST',
    headers: authHeaders(ctx.builderToken),
    body: JSON.stringify({ workflowId, waitKey: 'review', role: 'reviewer', type: 'review', ...body }),
  });
  return { status: res.status, data: await res.json() };
}

async function storedRow(escalationId: string) {
  const { rows } = await getPool().query(
    `SELECT metadata, envelope, assigned_to, claimed_at, assigned_until, claim_expires_at, origin_id, parent_id
     FROM public.hmsh_escalations WHERE id = $1`,
    [escalationId],
  );
  return rows[0];
}

describe('POST /escalations/waits: envelope, assignment and lineage', () => {
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.hmsh_escalations WHERE id IN (SELECT escalation_id FROM lt_durable_waits WHERE workflow_id LIKE $1)`, [`${RUN}%`]);
    await pool.query('DELETE FROM lt_durable_waits WHERE workflow_id LIKE $1', [`${RUN}%`]);
  });

  it('stores the envelope, lookups, files and pinned form version', async () => {
    const lookups = [{ domain: 'catalog', key: 'parts', version: 2 }];
    const files = [{ path: 'orders/o-1/invoice.pdf', as: 'invoice' }];
    const opened = await openWait(`${RUN}-envelope`, {
      envelope: { formDefaults: { notes: 'draft' }, confidence: { notes: 0.4 } },
      lookups, files, schemaVersion: 3, metadata: { orderId: 'o-1' },
    });
    expect(opened.status).toBe(201);
    const row = await storedRow(opened.data.escalationId);
    expect(row.envelope).toEqual({ formDefaults: { notes: 'draft' }, confidence: { notes: 0.4 }, lookups, files });
    expect(row.metadata).toEqual({ orderId: 'o-1', schema_version: 3 });

    const read = await fetch(`${ctx.BASE}/escalations/${opened.data.escalationId}`, { headers: authHeaders(ctx.builderToken) });
    const { envelope } = await read.json();
    expect(typeof envelope === 'string' ? JSON.parse(envelope) : envelope).toMatchObject({ formDefaults: { notes: 'draft' } });
  });

  it('keeps the envelope beside a batch declaration', async () => {
    const opened = await openWait(`${RUN}-batch`, { envelope: { formDefaults: { a: 1 } }, batch: ['left', 'right'] });
    const row = await storedRow(opened.data.escalationId);
    expect(row.envelope).toMatchObject({ formDefaults: { a: 1 }, batch_items: {} });
  });

  it('keeps the first envelope when the same wait opens again', async () => {
    const first = await openWait(`${RUN}-repeat`, { envelope: { formDefaults: { v: 1 } } });
    const again = await openWait(`${RUN}-repeat`, { envelope: { formDefaults: { v: 2 } } });
    expect(again.status).toBe(200);
    expect(again.data.escalationId).toBe(first.data.escalationId);
    expect((await storedRow(first.data.escalationId)).envelope).toEqual({ formDefaults: { v: 1 } });
  });

  it.each([
    [{ envelope: { batch_items: {} } }, /reserved/],
    [{ envelope: { lookups: [] }, lookups: [{ domain: 'd', key: 'k' }] }, /not both/],
    [{ lookups: [{ domain: '', key: 'k' }] }, /domain and key/],
    [{ files: [{ path: 'a.pdf' }] }, /as/],
    [{ schemaVersion: 0 }, /schemaVersion/],
    [{ envelope: 'x' }, /envelope/],
  ])('answers 400 for an invalid envelope field', async (body, message) => {
    const opened = await openWait(`${RUN}-bad-${Math.random()}`, body);
    expect(opened.status).toBe(400);
    expect(opened.data.error).toMatch(message);
  });

  it('pre-assigns with assignee alone, as HotMesh does', async () => {
    const opened = await openWait(`${RUN}-assign`, { assignee: ASSIGNEE });
    const row = await storedRow(opened.data.escalationId);
    expect(row.assigned_to).toBe(ASSIGNEE);
    expect(row.claimed_at).not.toBeNull();
    expect(row.assigned_until).toBeNull();
    expect(row.claim_expires_at).toBeNull();
  });

  it('claims for durationMinutes on the database clock', async () => {
    const opened = await openWait(`${RUN}-claim`, { assignee: ASSIGNEE, durationMinutes: 30 });
    const row = await storedRow(opened.data.escalationId);
    const minutes = (row.assigned_until.getTime() - row.claimed_at.getTime()) / 60_000;
    expect(minutes).toBeCloseTo(30, 3);
    expect(row.claim_expires_at.getTime()).toBe(row.assigned_until.getTime());
  });

  it('answers 400 for durationMinutes without an assignee', async () => {
    const opened = await openWait(`${RUN}-claim-bad`, { durationMinutes: 5 });
    expect(opened.status).toBe(400);
    expect(opened.data.error).toMatch(/requires assignee/);
  });

  it('links a child to its parent and origin', async () => {
    const parent = await openWait(`${RUN}-parent`, {});
    const child = await openWait(`${RUN}-child`, { parentId: parent.data.escalationId, originId: parent.data.escalationId });
    expect(child.status).toBe(201);
    const row = await storedRow(child.data.escalationId);
    expect(row).toMatchObject({ parent_id: parent.data.escalationId, origin_id: parent.data.escalationId });
  });

  it('refuses an origin that is not the parent\'s', async () => {
    const parent = await openWait(`${RUN}-parent2`, {});
    const other = await openWait(`${RUN}-other`, {});
    const child = await openWait(`${RUN}-child2`, { parentId: parent.data.escalationId, originId: other.data.escalationId });
    expect(child.status).toBe(400);
  });

  it('answers 404 for a lineage id that names no escalation', async () => {
    const child = await openWait(`${RUN}-orphan`, { parentId: '00000000-0000-4000-8000-00000000dead' });
    expect(child.status).toBe(404);
    const malformed = await openWait(`${RUN}-orphan2`, { originId: 'not-an-id' });
    expect(malformed.status).toBe(400);
  });
});
