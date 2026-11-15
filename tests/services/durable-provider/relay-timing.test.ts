import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { DurableRelay, openWait } from '../../../services/durable-provider';
import * as escalationService from '../../../services/escalation';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';

const { Connection } = Durable;
const PROVIDER = 'relay-timing-test';
const CREATOR = '00000000-0000-4000-8000-0000000000bc';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(workflowId: string, extra: Record<string, unknown> = {}) {
  const { escalation } = await openWait(PROVIDER, {
    workflowId, waitKey: 'decide', role: 'reviewer', type: 'decision', ...extra,
  }, CREATOR);
  return escalation.id;
}

async function openResolved(workflowIds: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const workflowId of workflowIds) {
    const id = await open(workflowId);
    await escalationService.resolveEscalation(id, {});
    ids.push(id);
  }
  return ids;
}

describe('durable relay leases and expiry timing', () => {
  const runId = `rt-${Date.now()}`;
  let provider: FakeDurableProvider;
  let relay: DurableRelay;

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
  }, 30_000);

  beforeEach(async () => {
    await getPool().query(`UPDATE lt_durable_waits SET delivered_at = NOW() WHERE provider = $1 AND delivered_at IS NULL`, [PROVIDER]);
    provider = new FakeDurableProvider(PROVIDER);
  });

  afterEach(async () => {
    await relay.stop();
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.hmsh_escalations WHERE id IN (SELECT escalation_id FROM lt_durable_waits WHERE provider = $1)`, [PROVIDER]);
    await pool.query('DELETE FROM lt_durable_waits WHERE provider = $1', [PROVIDER]);
    await Durable.shutdown();
  });

  it('skips a claimed wait whose lease lapsed, and a later pass delivers it', async () => {
    relay = new DurableRelay(provider, { reconcileMs: 0 });
    const ids = await openResolved([`${runId}-a`, `${runId}-b`]);
    const deliver = provider.deliver.bind(provider);
    vi.spyOn(provider, 'deliver').mockImplementationOnce(async (ref, outcome) => {
      const other = ids.find((id) => id !== outcome.escalationId);
      await getPool().query(`UPDATE lt_durable_waits SET lease_until = NOW() - INTERVAL '1 second' WHERE escalation_id = $1`, [other]);
      return deliver(ref, outcome);
    });
    const first = await relay.run();
    expect(first).toMatchObject({ delivered: 1, skipped: 1 });
    expect(provider.deliveries).toHaveLength(1);
    expect((await relay.run()).delivered).toBe(1);
    expect(provider.deliveries.map((d) => d.outcome.escalationId).sort()).toEqual([...ids].sort());
  });

  it('skips a claimed wait another relay delivered', async () => {
    relay = new DurableRelay(provider, { reconcileMs: 0 });
    const ids = await openResolved([`${runId}-c`, `${runId}-d`]);
    const deliver = provider.deliver.bind(provider);
    vi.spyOn(provider, 'deliver').mockImplementationOnce(async (ref, outcome) => {
      const other = ids.find((id) => id !== outcome.escalationId);
      await getPool().query(`UPDATE lt_durable_waits SET delivered_at = NOW(), delivery = 'delivered', lease_until = NULL WHERE escalation_id = $1`, [other]);
      return deliver(ref, outcome);
    });
    expect(await relay.run()).toMatchObject({ delivered: 1, skipped: 1 });
    expect((await relay.run()).delivered).toBe(0);
    expect(provider.deliveries).toHaveLength(1);
  });

  it('delivers each wait once when a batch outlasts the lease beside a second relay', async () => {
    relay = new DurableRelay(provider, { reconcileMs: 0, leaseMs: 1_000 });
    const other = new DurableRelay(provider, { reconcileMs: 0, leaseMs: 1_000 });
    const ids = await openResolved([1, 2, 3, 4].map((n) => `${runId}-slow-${n}`));
    const deliver = provider.deliver.bind(provider);
    vi.spyOn(provider, 'deliver').mockImplementation(async (ref, outcome) => {
      await sleep(400);
      return deliver(ref, outcome);
    });
    const slow = relay.run();
    let racing = true;
    const racer = (async () => {
      while (racing) {
        await sleep(100);
        await other.run();
      }
    })();
    await slow;
    racing = false;
    await racer;
    await relay.run();
    for (const id of ids) {
      expect(provider.deliveries.filter((d) => d.outcome.escalationId === id)).toHaveLength(1);
    }
  }, 15_000);

  it('expires a wait at its expiry, ahead of the sweep', async () => {
    relay = new DurableRelay(provider, { reconcileMs: 0, sweepMs: 60_000 });
    const id = await open(`${runId}-due`, { expiresAt: new Date(Date.now() + 500).toISOString() });
    relay.start();
    await sleep(1_500);
    expect((await escalationService.getEscalation(id))?.status).toBe('expired');
    expect(provider.deliveries.some((d) => d.outcome.escalationId === id && d.outcome.status === 'expired')).toBe(true);
  });

  it('leaves an expiry beyond the sweep interval to the sweep', async () => {
    relay = new DurableRelay(provider, { reconcileMs: 0, sweepMs: 200 });
    const id = await open(`${runId}-later`, { expiresAt: new Date(Date.now() + 600).toISOString() });
    relay.start();
    await sleep(1_300);
    expect((await escalationService.getEscalation(id))?.status).toBe('expired');
  });

  it('sets no expiry wake unless started', async () => {
    relay = new DurableRelay(provider, { reconcileMs: 0, sweepMs: 60_000 });
    const id = await open(`${runId}-manual`, { expiresAt: new Date(Date.now() + 300).toISOString() });
    await relay.run();
    await sleep(700);
    expect((await escalationService.getEscalation(id))?.status).toBe('pending');
    expect((await relay.run()).expired).toBe(1);
  });
});
