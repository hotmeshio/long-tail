import { describe, it, expect, afterAll } from 'vitest';

import { setupRouteTest, authHeaders } from './setup';
import { getPool } from '../../lib/db';
import { createEscalationOnce } from '../../services/escalation/crud';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

// A provider wait opened with a signal key is addressed by every signal-key
// surface, and the relay delivers its outcome once.
const provider = new FakeDurableProvider('route-wait-keys');
const ctx = setupRouteTest(4673, { durable: { provider } } as any);

const RUN = `route-wait-keys-${Date.now()}`;

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${ctx.BASE}/escalations/${path}`, {
    method: 'POST', headers: authHeaders(ctx.builderToken), body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

const openWait = (workflowId: string, signalKey: string, body: Record<string, unknown> = {}) =>
  post('waits', { workflowId, waitKey: 'review', role: 'reviewer', type: 'review', signalKey, ...body });

/** The deliveries to `workflowId`, once the relay has recorded one. */
async function settled(workflowId: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await getPool().query('SELECT delivered_at FROM lt_durable_waits WHERE workflow_id = $1', [workflowId]);
    if (rows[0]?.delivered_at) return provider.deliveries.filter((d) => d.ref.workflowId === workflowId);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`wait for ${workflowId} was not delivered`);
}

describe('signal keys on provider waits', () => {
  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.hmsh_escalations WHERE id IN (SELECT escalation_id FROM lt_durable_waits WHERE workflow_id LIKE $1)`, [`${RUN}%`]);
    await pool.query('DELETE FROM lt_durable_waits WHERE workflow_id LIKE $1', [`${RUN}%`]);
    await pool.query('DELETE FROM public.hmsh_escalations WHERE signal_key LIKE $1', [`${RUN}%`]);
  });

  it('keeps the key on the wait, never on the escalation row', async () => {
    const opened = await openWait(`${RUN}-store`, `${RUN}-store-key`);
    expect(opened.status).toBe(201);
    const { rows } = await getPool().query(
      `SELECT w.signal_key AS wait_key, e.signal_key AS row_key FROM lt_durable_waits w
       JOIN public.hmsh_escalations e ON e.id = w.escalation_id WHERE w.escalation_id = $1`,
      [opened.data.escalationId],
    );
    expect(rows[0]).toEqual({ wait_key: `${RUN}-store-key`, row_key: null });
  });

  it('returns the same wait when it opens again with its key', async () => {
    const first = await openWait(`${RUN}-repeat`, `${RUN}-repeat-key`);
    const again = await openWait(`${RUN}-repeat`, `${RUN}-repeat-key`);
    expect(again).toMatchObject({ status: 200, data: { escalationId: first.data.escalationId } });
  });

  it('answers 409 for a key another wait or a HotMesh escalation holds', async () => {
    await openWait(`${RUN}-held-a`, `${RUN}-held-key`);
    const taken = await openWait(`${RUN}-held-b`, `${RUN}-held-key`);
    expect(taken.status).toBe(409);

    await createEscalationOnce({ type: 'review', role: 'reviewer' } as any, `${RUN}-hotmesh-key`);
    const hotmesh = await openWait(`${RUN}-held-c`, `${RUN}-hotmesh-key`);
    expect(hotmesh.status).toBe(409);
  });

  it('reopens its own wait even after a HotMesh escalation took the same key', async () => {
    const first = await openWait(`${RUN}-late`, `${RUN}-late-key`);
    await createEscalationOnce({ type: 'review', role: 'reviewer' } as any, `${RUN}-late-key`);
    const again = await openWait(`${RUN}-late`, `${RUN}-late-key`);
    expect(again).toMatchObject({ status: 200, data: { escalationId: first.data.escalationId } });
  });

  it('resolves by key and delivers the outcome once', async () => {
    const opened = await openWait(`${RUN}-resolve`, `${RUN}-resolve-key`);
    const resolved = await post('resolve-by-signal-key', { signalKey: `${RUN}-resolve-key`, resolverPayload: { approved: true } });
    expect(resolved.status).toBe(200);
    const again = await post('resolve-by-signal-key', { signalKey: `${RUN}-resolve-key`, resolverPayload: { approved: false } });
    expect(again.status).toBe(409);
    const deliveries = await settled(`${RUN}-resolve`);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].outcome).toMatchObject({ status: 'resolved', data: { approved: true } });
  });

  it('settles one outcome when resolves by id and by key race', async () => {
    const opened = await openWait(`${RUN}-race`, `${RUN}-race-key`);
    const results = await Promise.all([
      post(`${opened.data.escalationId}/resolve`, { resolverPayload: { by: 'id' } }),
      post('resolve-by-signal-key', { signalKey: `${RUN}-race-key`, resolverPayload: { by: 'key' } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await settled(`${RUN}-race`)).toHaveLength(1);
  });

  it('adds to a provider accumulator by key, and fills a provider batch by key', async () => {
    await openWait(`${RUN}-acc`, `${RUN}-acc-key`, { accumulate: { max: 1 } });
    const added = await post('accumulate-by-signal-key', { signalKey: `${RUN}-acc-key`, itemKey: 'ana', payload: { v: 1 } });
    expect(added.status).toBe(200);
    const [delivered] = await settled(`${RUN}-acc`);
    expect(delivered.outcome.data?.$accumulated).toEqual([expect.objectContaining({ itemKey: 'ana' })]);

    await openWait(`${RUN}-batch`, `${RUN}-batch-key`, { batch: ['left'] });
    const filled = await post('resolve-batch-item-by-signal-key', { signalKey: `${RUN}-batch-key`, itemKey: 'left', resolverPayload: { ok: true } });
    expect(filled.status).toBe(200);
    expect((await settled(`${RUN}-batch`))[0].outcome.data).toMatchObject({ left: { ok: true } });
  });

  it('writes a reciprocal named by a provider key in the same add', async () => {
    const home = await openWait(`${RUN}-home`, `${RUN}-home-key`, { accumulate: {} });
    const peer = await openWait(`${RUN}-peer`, `${RUN}-peer-key`, { accumulate: {} });
    const added = await post(`${home.data.escalationId}/accumulate`, {
      itemKey: 'pair-1', payload: { side: 'home' }, reciprocal: { signalKey: `${RUN}-peer-key`, payload: { side: 'peer' } },
    });
    expect(added.status).toBe(200);
    const { rows } = await getPool().query('SELECT envelope FROM public.hmsh_escalations WHERE id = $1', [peer.data.escalationId]);
    expect(Object.keys(rows[0].envelope.accumulate_items)).toHaveLength(1);
  });

  it('answers 404 for a key nothing holds', async () => {
    const missing = await post('resolve-by-signal-key', { signalKey: `${RUN}-nobody`, resolverPayload: {} });
    expect(missing.status).toBe(404);
  });
});
