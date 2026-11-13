import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { DurableRelay, openWait } from '../../../services/durable-provider';
import * as escalationService from '../../../services/escalation';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';

// Batch and accumulate waits on a provider: the row takes HotMesh's shape,
// every fill and add runs through the escalation store, and the relay
// delivers what HotMesh's waiter would receive.
vi.mock('../../../lib/events/publish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/events/publish')>()),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

const { Connection } = Durable;
const PROVIDER = 'collections-test';
const CREATOR = '00000000-0000-4000-8000-0000000000cc';
const PAST = () => new Date(Date.now() - 1000).toISOString();

async function open(workflowId: string, extra: Record<string, unknown>) {
  const { escalation } = await openWait(PROVIDER, {
    workflowId, waitKey: 'collect', role: 'reviewer', type: 'collect', ...extra,
  }, CREATOR);
  return escalation;
}

describe('batch and accumulate waits on a provider', () => {
  const runId = `c-${Date.now()}`;
  let provider: FakeDurableProvider;
  let relay: DurableRelay;

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
  }, 30_000);

  beforeEach(async () => {
    await getPool().query(`UPDATE lt_durable_waits SET delivered_at = NOW() WHERE provider = $1 AND delivered_at IS NULL`, [PROVIDER]);
    provider = new FakeDurableProvider(PROVIDER);
    relay = new DurableRelay(provider, { reconcileMs: 0 });
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.hmsh_escalations WHERE id IN (SELECT escalation_id FROM lt_durable_waits WHERE provider = $1)`, [PROVIDER]);
    await pool.query('DELETE FROM lt_durable_waits WHERE provider = $1', [PROVIDER]);
    await Durable.shutdown();
  });

  it('opens a batch row with the declared keys pending and an empty item store', async () => {
    const row = await open(`${runId}-shape`, { batch: ['cut', 'weld'], metadata: { orderId: 'o-1' } });
    expect(row.metadata).toMatchObject({ orderId: 'o-1', batch_pending: ['cut', 'weld'], batch_count: 2, batch_keys: ['cut', 'weld'] });
    const envelope = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
    expect(envelope).toMatchObject({ batch_items: {}, batch_filled_at: {} });
  });

  it('delivers every item when the last batch item is filled', async () => {
    const { id } = await open(`${runId}-batch`, { batch: ['cut', 'weld'] });
    expect((await escalationService.resolveBatchItem(id, 'cut', { ok: true })).outcome).toBe('accepted');
    expect((await relay.run()).delivered).toBe(0);
    expect((await escalationService.resolveBatchItem(id, 'weld', { ok: false })).outcome).toBe('completed');
    await relay.run();
    expect(provider.deliveries).toHaveLength(1);
    expect(provider.deliveries[0].outcome).toMatchObject({ status: 'resolved', data: { cut: { ok: true }, weld: { ok: false } } });
  });

  it('starts with the filled entries and delivers them with the collection', async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const { id } = await open(`${runId}-filled`, { batch: ['cut', 'weld'], filled: { cut: { payload: { ok: true }, at, actor: 'u-7' } } });
    expect((await escalationService.getEscalation(id))?.metadata).toMatchObject({ batch_pending: ['weld'], batch_count: 1 });
    await escalationService.resolveBatchItem(id, 'weld', { ok: true });
    await relay.run();
    expect(provider.deliveries[0].outcome.data).toMatchObject({ cut: { ok: true }, weld: { ok: true } });
  });

  it('wakes on a fill with the items so far when wakeOnFill is set', async () => {
    const { id } = await open(`${runId}-fill`, { batch: ['a', 'b'], wakeOnFill: true });
    expect((await escalationService.resolveBatchItem(id, 'a', { n: 1 })).outcome).toBe('woke');
    await relay.run();
    expect(provider.deliveries[0].outcome).toMatchObject({ status: 'resolved', data: { a: { n: 1 }, $filled: ['a'], $trigger: 'fill' } });
  });

  it('delivers the filled items on expiry with partialOnTimeout', async () => {
    const { id } = await open(`${runId}-partial`, { batch: ['a', 'b'], partialOnTimeout: true, expiresAt: PAST() });
    await getPool().query(`UPDATE public.hmsh_escalations SET expires_at = NOW() + INTERVAL '1 hour' WHERE id = $1`, [id]);
    await escalationService.resolveBatchItem(id, 'a', { n: 1 });
    await getPool().query(`UPDATE public.hmsh_escalations SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [id]);
    expect((await relay.run()).expired).toBe(1);
    expect(provider.deliveries[0].outcome).toMatchObject({ status: 'expired', data: { a: { n: 1 }, $trigger: 'timeout' } });
  });

  it('delivers no data when a batch without partialOnTimeout expires', async () => {
    await open(`${runId}-nopartial`, { batch: ['a', 'b'], expiresAt: PAST() });
    await relay.run();
    expect(provider.deliveries[0].outcome.status).toBe('expired');
    expect(provider.deliveries[0].outcome.data).toBeUndefined();
  });

  it('delivers the accumulated items when the count reaches max', async () => {
    const { id } = await open(`${runId}-count`, { accumulate: { max: 2 } });
    expect((await escalationService.accumulateItem(id, { itemKey: 'x', payload: { v: 1 } })).outcome).toBe('accepted');
    expect((await escalationService.accumulateItem(id, { itemKey: 'y', payload: { v: 2 } })).outcome).toBe('completed');
    await relay.run();
    const { data } = provider.deliveries[0].outcome as any;
    expect(data.$trigger).toBe('count');
    expect(data.$accumulated.map((item: any) => [item.itemKey, item.payload])).toEqual([['x', { v: 1 }], ['y', { v: 2 }]]);
  });

  it('delivers the accumulated items on expiry', async () => {
    const { id } = await open(`${runId}-acc-timeout`, { accumulate: {} });
    await getPool().query(`UPDATE public.hmsh_escalations SET expires_at = NOW() + INTERVAL '1 hour' WHERE id = $1`, [id]);
    await escalationService.accumulateItem(id, { itemKey: 'x', payload: { v: 1 } });
    await getPool().query(`UPDATE public.hmsh_escalations SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [id]);
    await relay.run();
    expect(provider.deliveries[0].outcome).toMatchObject({ status: 'expired', data: { $trigger: 'timeout', $accumulated: [expect.objectContaining({ itemKey: 'x' })] } });
  });

  it('merges the collection into a manual resolve of an accumulator', async () => {
    const { id } = await open(`${runId}-acc-resolve`, { accumulate: {} });
    await escalationService.accumulateItem(id, { itemKey: 'x', payload: { v: 1 } });
    await escalationService.resolveEscalation(id, { closedBy: 'lead' });
    await relay.run();
    expect(provider.deliveries[0].outcome).toMatchObject({
      status: 'resolved',
      data: { closedBy: 'lead', $trigger: 'resolve', $accumulated: [expect.objectContaining({ itemKey: 'x' })] },
    });
  });

  it('refuses an invalid declaration before writing anything', async () => {
    await expect(open(`${runId}-bad`, { batch: ['a'], accumulate: {} })).rejects.toThrow(/mutually exclusive/);
    const { rows } = await getPool().query('SELECT 1 FROM lt_durable_waits WHERE provider = $1 AND workflow_id = $2', [PROVIDER, `${runId}-bad`]);
    expect(rows).toHaveLength(0);
  });
});
