import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { DurableRelay, openWait, getWaitByEscalationId, backoffMs, RELAY_DEFAULTS } from '../../../services/durable-provider';
import * as escalationService from '../../../services/escalation';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';
import { JOB_STATE } from '../../../types/durable-provider';

const publishWorkflowEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/events/publish', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/events/publish')>()),
  publishWorkflowEvent: (...a: unknown[]) => publishWorkflowEvent(...a),
}));

const { Connection } = Durable;
const PROVIDER = 'relay-test';
const CREATOR = '00000000-0000-4000-8000-0000000000bb';

async function open(workflowId: string, extra: Record<string, unknown> = {}) {
  const { escalation } = await openWait(PROVIDER, {
    workflowId, waitKey: 'decide', role: 'reviewer', type: 'decision', ...extra,
  }, CREATOR);
  return escalation.id;
}

describe('durable relay', () => {
  const runId = `r-${Date.now()}`;
  let provider: FakeDurableProvider;
  let relay: DurableRelay;

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
  }, 30_000);

  beforeEach(async () => {
    // Earlier tests' terminal waits stay delivered; nothing else is claimable.
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

  it('delivers a resolved outcome once, with the resolver payload', async () => {
    const id = await open(`${runId}-a`);
    await escalationService.resolveEscalation(id, { approved: true, notes: 'ok' });
    const first = await relay.run();
    const second = await relay.run();
    expect(first.delivered).toBe(1);
    expect(second.delivered).toBe(0);
    expect(provider.deliveries).toHaveLength(1);
    expect(provider.deliveries[0].ref).toMatchObject({ provider: PROVIDER, workflowId: `${runId}-a`, waitKey: 'decide' });
    expect(provider.deliveries[0].outcome).toMatchObject({ status: 'resolved', escalationId: id, data: { approved: true, notes: 'ok' } });
    expect((await getWaitByEscalationId(id))?.delivery).toBe('delivered');
  });

  it('publishes the workflow\'s completion after delivering, once the engine reports it closed', async () => {
    const workflowId = `${runId}-follow`;
    const id = await open(workflowId, { workflowType: 'reviewOrder' });
    await escalationService.resolveEscalation(id, { approved: true });
    provider.setState(workflowId, JOB_STATE.COMPLETED);
    expect((await relay.run()).delivered).toBe(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(publishWorkflowEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'workflow.completed', workflowId, workflowName: 'reviewOrder', source: 'durable-relay',
    }));
    await relay.stop();
  });

  it('leaves a pending wait alone', async () => {
    await open(`${runId}-b`);
    const result = await relay.run();
    expect(result.delivered).toBe(0);
    expect(provider.deliveries).toHaveLength(0);
  });

  it('delivers cancelled without data', async () => {
    const id = await open(`${runId}-c`);
    await escalationService.cancelEscalation(id);
    await relay.run();
    expect(provider.deliveries[0].outcome.status).toBe('cancelled');
    expect(provider.deliveries[0].outcome.data).toBeUndefined();
  });

  it('expires an overdue wait and delivers expired', async () => {
    const id = await open(`${runId}-d`, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const result = await relay.run();
    expect(result.expired).toBe(1);
    expect((await escalationService.getEscalation(id))?.status).toBe('expired');
    expect(provider.deliveries[0].outcome.status).toBe('expired');
  });

  it('records gone and stops when the workflow no longer exists', async () => {
    const id = await open(`${runId}-e`);
    provider.markGone(`${runId}-e`);
    await escalationService.resolveEscalation(id, {});
    const result = await relay.run();
    expect(result.gone).toBe(1);
    expect((await getWaitByEscalationId(id))?.delivery).toBe('gone');
    expect((await relay.run()).gone).toBe(0);
  });

  it('backs off after a failed delivery and keeps the error', async () => {
    const id = await open(`${runId}-f`);
    provider.failNext(`${runId}-f`);
    await escalationService.resolveEscalation(id, {});
    const result = await relay.run();
    expect(result.retried).toBe(1);
    const wait = await getWaitByEscalationId(id);
    expect(wait?.delivered_at).toBeNull();
    expect(wait?.last_error).toBe('engine unavailable');
    expect((await relay.run()).delivered).toBe(0);
    await getPool().query('UPDATE lt_durable_waits SET next_attempt_at = NOW() WHERE escalation_id = $1', [id]);
    expect((await relay.run()).delivered).toBe(1);
  });

  it('delivers once when two relays race', async () => {
    const id = await open(`${runId}-g`);
    await escalationService.resolveEscalation(id, {});
    const other = new DurableRelay(provider, { reconcileMs: 0 });
    await Promise.all([relay.run(), other.run()]);
    expect(provider.deliveries.filter((d) => d.outcome.escalationId === id)).toHaveLength(1);
  });

  it('reconcile cancels escalations whose workflow ended, then delivers cancelled', async () => {
    const id = await open(`${runId}-h`);
    provider.setState(`${runId}-h`, 'completed');
    const cancelled = await relay.reconcile();
    expect(cancelled).toBeGreaterThanOrEqual(1);
    expect((await escalationService.getEscalation(id))?.status).toBe('cancelled');
    await relay.run();
    expect(provider.deliveries.some((d) => d.outcome.escalationId === id && d.outcome.status === 'cancelled')).toBe(true);
  });

  it('caps backoff and rejects invalid config', () => {
    expect(backoffMs(1)).toBe(RELAY_DEFAULTS.BACKOFF_BASE_MS);
    expect(backoffMs(2)).toBe(RELAY_DEFAULTS.BACKOFF_BASE_MS * 2);
    expect(backoffMs(100)).toBe(RELAY_DEFAULTS.BACKOFF_MAX_MS);
    expect(() => new DurableRelay(provider, { batch: 0 })).toThrow(/positive/);
    expect(() => new DurableRelay(provider, { reconcileMs: -1 })).toThrow(/reconcileMs/);
  });
});
