/**
 * Batch escalation — end-to-end through the public HTTP API.
 *
 * One `conditional({ batch: ['cut','weld','paint'] })` wait writes ONE
 * escalation row declaring the expected item keys. Items are submitted via
 * the by-id and by-metadata batch endpoints; interim fills return
 * `accepted` with the remaining count, duplicates and undeclared keys are
 * rejected, and the LAST fill completes the escalation and resumes the
 * workflow with the full typed collection.
 *
 * Requires: docker compose up -d --build
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { ApiClient, log, poll } from './helpers';

const PASSWORD = 'l0ngt@1l';
const ORDER_ID = `batch-it-${Date.now()}`;

let api: ApiClient;
let workflowId: string;
let escalationId: string;
let signalKey: string;

beforeAll(async () => {
  api = new ApiClient();
  await api.login('superadmin', PASSWORD);
  log('setup', 'superadmin logged in');

  const { data } = await api.post('/api/workflows/batchSignal/invoke', {
    data: { orderId: ORDER_ID, role: 'reviewer', message: 'Submit each station result' },
  });
  workflowId = data.workflowId;
  log('setup', `batchSignal started: ${workflowId}`);
}, 60_000);

describe('Batch escalation lifecycle', () => {
  it('writes one escalation with the accumulator facets folded at creation', async () => {
    const row = await poll(
      'batch escalation row',
      async () => {
        const { data } = await api.get('/api/escalations/by-metadata', {
          key: 'orderId',
          value: ORDER_ID,
        });
        return data?.escalations?.[0] ?? null;
      },
      30_000,
      500,
    );
    escalationId = row.id;
    signalKey = row.signal_key;
    expect(row.status).toBe('pending');
    expect(row.signal_key).toBeTruthy();
    expect(row.metadata.batch_pending).toEqual(['cut', 'weld', 'paint']);
    expect(row.metadata.batch_count).toBe(3);
    expect(row.metadata.batch_keys).toEqual(['cut', 'weld', 'paint']);
    log('row', `escalation: ${escalationId}`);
  }, 40_000);

  it('accepts the first item via the by-signal-key endpoint', async () => {
    const { status, data } = await api.post('/api/escalations/resolve-batch-item-by-signal-key', {
      signalKey,
      itemKey: 'cut',
      resolverPayload: { ok: true, notes: 'cut complete' },
    });
    expect(status).toBe(200);
    expect(data.outcome).toBe('accepted');
    expect(data.remaining).toBe(2);
  });

  it('rejects a duplicate submission of the same item with 409', async () => {
    await expect(api.post(`/api/escalations/${escalationId}/resolve-batch-item`, {
      itemKey: 'cut',
      resolverPayload: { ok: false },
    })).rejects.toThrow(/409.*Batch item already submitted/);
  });

  it('rejects an undeclared item key with 400', async () => {
    await expect(api.post(`/api/escalations/${escalationId}/resolve-batch-item`, {
      itemKey: 'polish',
      resolverPayload: { ok: true },
    })).rejects.toThrow(/400.*not in the declared batch/);
  });

  it('accepts the second item via the by-metadata endpoint', async () => {
    const { status, data } = await api.post('/api/escalations/resolve-batch-item-by-metadata', {
      key: 'orderId',
      value: ORDER_ID,
      itemKey: 'weld',
      resolverPayload: { ok: true, notes: 'weld complete' },
    });
    expect(status).toBe(200);
    expect(data.outcome).toBe('accepted');
    expect(data.remaining).toBe(1);
  });

  it('the row stays pending with progress visible in the facets', async () => {
    const { data } = await api.get(`/api/escalations/${escalationId}`);
    expect(data.status).toBe('pending');
    expect(data.metadata.batch_pending).toEqual(['paint']);
    expect(data.metadata.batch_count).toBe(1);
  });

  it('completes on the last item and resumes the workflow with the collection', async () => {
    const { status, data } = await api.post(`/api/escalations/${escalationId}/resolve-batch-item`, {
      itemKey: 'paint',
      resolverPayload: { ok: true, notes: 'paint complete' },
    });
    expect(status).toBe(200);
    expect(data.outcome).toBe('completed');
    expect(data.remaining).toBe(0);
    expect(data.signaled).toBe(true);

    const result = await poll(
      'workflow result',
      async () => {
        try {
          const r = await api.getWorkflowResult(workflowId);
          return r?.result?.type === 'return' ? r : null;
        } catch {
          return null;
        }
      },
      60_000,
      2_000,
    );
    expect(result.result.data.completed).toBe(true);
    expect(result.result.data.allOk).toBe(true);
    expect(result.result.data.stations.cut).toEqual({ ok: true, notes: 'cut complete' });
    expect(result.result.data.stations.weld).toEqual({ ok: true, notes: 'weld complete' });
    expect(result.result.data.stations.paint).toEqual({ ok: true, notes: 'paint complete' });
  }, 90_000);

  it('the resolved row stores the assembled collection as resolver_payload', async () => {
    const { data } = await api.get(`/api/escalations/${escalationId}`);
    expect(data.status).toBe('resolved');
    const payload = JSON.parse(data.resolver_payload);
    expect(Object.keys(payload).sort()).toEqual(['cut', 'paint', 'weld']);
  });

  it('a late fill after completion reports the conflict', async () => {
    await expect(api.post(`/api/escalations/${escalationId}/resolve-batch-item`, {
      itemKey: 'weld',
      resolverPayload: { ok: true },
    })).rejects.toThrow(/409/);
  });
});
