import { describe, it, expect, afterAll } from 'vitest';

import { setupRouteTest, authHeaders } from './setup';
import { getPool } from '../../lib/db';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

// The waits route carries batch and accumulate declarations to the row.
const ctx = setupRouteTest(4671, { durable: { provider: new FakeDurableProvider('route-waits') } } as any);

const ROLE = 'reviewer';
const RUN = `route-waits-${Date.now()}`;

async function openWait(workflowId: string, body: Record<string, unknown>) {
  const res = await fetch(`${ctx.BASE}/escalations/waits`, {
    method: 'POST',
    headers: authHeaders(ctx.builderToken),
    body: JSON.stringify({ workflowId, waitKey: 'collect', role: ROLE, type: 'collect', ...body }),
  });
  return { status: res.status, data: await res.json() };
}

async function storedRow(escalationId: string) {
  const { rows } = await getPool().query('SELECT metadata, envelope FROM public.hmsh_escalations WHERE id = $1', [escalationId]);
  return rows[0];
}

describe('POST /escalations/waits', () => {
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.hmsh_escalations WHERE id IN (SELECT escalation_id FROM lt_durable_waits WHERE workflow_id LIKE $1)`, [`${RUN}%`]);
    await pool.query('DELETE FROM lt_durable_waits WHERE workflow_id LIKE $1', [`${RUN}%`]);
  });

  it('stores a batch declaration in the row', async () => {
    const opened = await openWait(`${RUN}-batch`, { batch: ['left', 'right'], partialOnTimeout: true, wakeOnFill: ['left'] });
    expect(opened.status).toBe(201);
    const row = await storedRow(opened.data.escalationId);
    expect(row.metadata).toMatchObject({ batch_pending: ['left', 'right'], batch_keys: ['left', 'right'] });
    expect(row.envelope).toMatchObject({ batch_items: {}, batch_partial_on_timeout: true, batch_wake_on_fill: ['left'] });
  });

  it('stores an accumulate declaration in the row', async () => {
    const opened = await openWait(`${RUN}-acc`, { accumulate: { max: 3 } });
    expect(opened.status).toBe(201);
    const row = await storedRow(opened.data.escalationId);
    expect(row.metadata).toMatchObject({ accumulate_count: 0, accumulate_max: 3 });
    expect(row.envelope).toMatchObject({ accumulate_items: {} });
  });

  it('answers 400 for an invalid declaration', async () => {
    const opened = await openWait(`${RUN}-bad`, { batch: ['a'], accumulate: {} });
    expect(opened.status).toBe(400);
    expect(opened.data.error).toMatch(/mutually exclusive/);
  });
});
