/**
 * Open accumulator — end-to-end through the public HTTP API.
 *
 * One `conditionalAccumulator({ accumulate: { max } })` wait writes ONE
 * container row. Bags join through the by-signal-key, by-metadata, and by-id
 * add endpoints (one with a reciprocal member row), a held bag is removed
 * and re-added, the add that reaches max completes the container and
 * resumes the workflow with the ordered collection, and a second bin whose
 * window closes delivers its partial collection with `$trigger: 'timeout'`.
 *
 * Requires: docker compose up -d --build (with @hotmeshio/hotmesh >= 0.29.0)
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { ApiClient, log, poll } from './helpers';

const PASSWORD = 'l0ngt@1l';
const RUN = Date.now();
const BIN_KEY = `bin-it-${RUN}`;
const SLOW_BIN_KEY = `bin-slow-${RUN}`;
const ORDER_A = `bag-a-${RUN}`;
const ORDER_B = `bag-b-${RUN}`;
const ORDER_C = `bag-c-${RUN}`;

let api: ApiClient;
let binWorkflowId: string;
let slowWorkflowId: string;
let binId: string;
let binSignalKey: string;
let memberAId: string;

const findRow = (key: string, value: string) => poll(
  `${key}=${value}`,
  async () => {
    const { data } = await api.get('/api/escalations/by-metadata', { key, value, status: 'pending' });
    return data?.escalations?.[0] ?? null;
  },
  30_000,
  500,
);

const workflowResult = (workflowId: string, timeout = 60_000) => poll(
  `result ${workflowId}`,
  async () => {
    try {
      const r = await api.getWorkflowResult(workflowId);
      return r?.result?.type === 'return' ? r : null;
    } catch {
      return null;
    }
  },
  timeout,
  2_000,
);

beforeAll(async () => {
  api = new ApiClient();
  await api.login('superadmin', PASSWORD);
  log('setup', 'superadmin logged in');

  const bin = await api.post('/api/workflows/rollupBin/invoke', { data: { binKey: BIN_KEY, max: 3, timeout: '10m' } });
  binWorkflowId = bin.data.workflowId;
  const slow = await api.post('/api/workflows/rollupBin/invoke', { data: { binKey: SLOW_BIN_KEY, max: 5, timeout: '20s' } });
  slowWorkflowId = slow.data.workflowId;
  await api.post('/api/workflows/rollupMember/invoke', { data: { orderId: ORDER_A, binKey: BIN_KEY } });
  log('setup', `rollupBin ${binWorkflowId}, slow bin ${slowWorkflowId}, member ${ORDER_A}`);
}, 60_000);

describe('Accumulator escalation lifecycle', () => {
  it('writes the container with the accumulator facets folded at creation', async () => {
    const row = await findRow('binKey', BIN_KEY);
    binId = row.id;
    binSignalKey = row.signal_key;
    expect(row.status).toBe('pending');
    expect(row.metadata.accumulate_count).toBe(0);
    expect(row.metadata.accumulate_max).toBe(3);
    expect(row.metadata.accumulate_keys).toEqual([]);
    const memberA = await findRow('orderId', ORDER_A);
    memberAId = memberA.id;
    expect(memberA.metadata.accumulate_max).toBe(1);
  }, 40_000);

  it('adds the first bag by signal key with the member as reciprocal, completing the member', async () => {
    const { status, data } = await api.post('/api/escalations/accumulate-by-signal-key', {
      signalKey: binSignalKey,
      itemKey: ORDER_A,
      payload: { weight: 2 },
      reciprocal: { id: memberAId },
    });
    expect(status).toBe(200);
    expect(data.outcome).toBe('accepted');
    expect(data.count).toBe(1);
    expect(data.remaining).toBe(2);
    expect(data.reciprocal).toMatchObject({ outcome: 'completed', count: 1, escalationId: memberAId, signaled: true });

    const member = await api.getEscalation(memberAId);
    expect(member.status).toBe('resolved');
    const memberPayload = JSON.parse(member.resolver_payload);
    expect(memberPayload.$trigger).toBe('count');
    expect(memberPayload.$accumulated[0].itemKey).toBe(binId);
  });

  it('rejects a duplicate bag with 409 and leaves the count unchanged', async () => {
    await expect(api.post(`/api/escalations/${binId}/accumulate`, { itemKey: ORDER_A }))
      .rejects.toThrow(/409.*already held/);
    const row = await api.getEscalation(binId);
    expect(row.metadata.accumulate_count).toBe(1);
  });

  it('adds by metadata, removes, and re-adds the second bag', async () => {
    const added = await api.post('/api/escalations/accumulate-by-metadata', {
      key: 'binKey', value: BIN_KEY, itemKey: ORDER_B, payload: { weight: 3 },
    });
    expect(added.data).toMatchObject({ outcome: 'accepted', count: 2, remaining: 1 });

    const removed = await api.post(`/api/escalations/${binId}/remove-item`, { itemKey: ORDER_B });
    expect(removed.data).toMatchObject({ outcome: 'removed', count: 1 });
    await expect(api.post(`/api/escalations/${binId}/remove-item`, { itemKey: ORDER_B }))
      .rejects.toThrow(/404.*not held/);

    const again = await api.post('/api/escalations/remove-item-by-metadata', {
      key: 'binKey', value: BIN_KEY, itemKey: ORDER_A,
    }).catch((e: Error) => e);
    expect(again).not.toBeInstanceOf(Error);
    const readd = await api.post(`/api/escalations/${binId}/accumulate`, { itemKey: ORDER_A, payload: { weight: 2 } });
    expect(readd.data.count).toBe(1);
    const readdB = await api.post(`/api/escalations/${binId}/accumulate`, { itemKey: ORDER_B, payload: { weight: 3 } });
    expect(readdB.data.count).toBe(2);
  });

  it('lists the held items in arrival order', async () => {
    const { data } = await api.get(`/api/escalations/${binId}/items`);
    expect(data.kind).toBe('accumulate');
    expect(data.count).toBe(2);
    expect(data.max).toBe(3);
    expect(data.items.map((i: any) => i.itemKey)).toEqual([ORDER_A, ORDER_B]);
    expect(data.items[0].payload).toEqual({ weight: 2 });
    expect(data.items[0].actor).toBeTruthy();
  });

  it('completes at max and resumes the workflow with the ordered collection', async () => {
    const { data } = await api.post(`/api/escalations/${binId}/accumulate`, { itemKey: ORDER_C, payload: { weight: 1 } });
    expect(data).toMatchObject({ outcome: 'completed', count: 3, remaining: 0, signaled: true, workflowId: binWorkflowId });

    const result = await workflowResult(binWorkflowId);
    expect(result.result.data.shipped).toBe(true);
    expect(result.result.data.trigger).toBe('count');
    expect(result.result.data.bags).toEqual([ORDER_A, ORDER_B, ORDER_C]);
    expect(result.result.data.totalWeight).toBe(6);

    const row = await api.getEscalation(binId);
    expect(row.status).toBe('resolved');
    const payload = JSON.parse(row.resolver_payload);
    expect(payload.$trigger).toBe('count');
    expect(payload.$accumulated).toHaveLength(3);
  }, 90_000);

  it('a late add names the terminal state', async () => {
    await expect(api.post(`/api/escalations/${binId}/accumulate`, { itemKey: 'late' }))
      .rejects.toThrow(/409/);
  });

  it('a bin whose window closes delivers its partial collection with the timeout trigger', async () => {
    const slow = await findRow('binKey', SLOW_BIN_KEY);
    const { data } = await api.post(`/api/escalations/${slow.id}/accumulate`, { itemKey: 'only-bag', payload: { weight: 4 } });
    expect(data.outcome).toBe('accepted');

    const result = await workflowResult(slowWorkflowId, 90_000);
    expect(result.result.data.shipped).toBe(true);
    expect(result.result.data.trigger).toBe('timeout');
    expect(result.result.data.bags).toEqual(['only-bag']);

    const row = await api.getEscalation(slow.id);
    expect(row.status).toBe('expired');
    expect(JSON.parse(row.resolver_payload).$trigger).toBe('timeout');
  }, 120_000);
});
