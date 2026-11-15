import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { cancelRunWaits, cancelWaitsIfRunClosed, cancelWaitsOfClosedRun, durableProviderRegistry, openWait } from '../../../services/durable-provider';
import * as escalationService from '../../../services/escalation';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';
import { JOB_STATE } from '../../../types/durable-provider';

const { Connection } = Durable;
const PROVIDER = 'closure-test';
const CREATOR = '00000000-0000-4000-8000-0000000000bc';

async function open(workflowId: string, runScope?: string, waitKey = 'decide') {
  const { escalation } = await openWait(PROVIDER, { workflowId, runScope, waitKey, role: 'reviewer', type: 'decision' }, CREATOR);
  return escalation.id;
}

async function statusOf(id: string) {
  return (await escalationService.getEscalation(id))?.status;
}

describe('closing the waits of an ended run', () => {
  const runId = `c-${Date.now()}`;
  let provider: FakeDurableProvider;

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
  }, 30_000);

  beforeEach(() => {
    provider = new FakeDurableProvider(PROVIDER);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query(`DELETE FROM public.hmsh_escalations WHERE id IN (SELECT escalation_id FROM lt_durable_waits WHERE provider = $1)`, [PROVIDER]);
    await pool.query('DELETE FROM lt_durable_waits WHERE provider = $1', [PROVIDER]);
    await Durable.shutdown();
  });

  it.each([JOB_STATE.COMPLETED, JOB_STATE.FAILED, JOB_STATE.CANCELLED, JOB_STATE.TERMINATED])('cancels the escalations of a %s run', async (state) => {
    const workflowId = `${runId}-closed-${state}`;
    const id = await open(workflowId);
    provider.setState(workflowId, state);
    expect(await cancelWaitsOfClosedRun(provider, workflowId, '')).toBe(1);
    expect(await statusOf(id)).toBe('cancelled');
  });

  it.each([JOB_STATE.RUNNING, JOB_STATE.UNKNOWN])('keeps the escalations of a %s run pending', async (state) => {
    const workflowId = `${runId}-open-${state}`;
    const id = await open(workflowId);
    provider.setState(workflowId, state);
    expect(await cancelWaitsOfClosedRun(provider, workflowId, '')).toBe(0);
    expect(await statusOf(id)).toBe('pending');
  });

  it('asks the engine about the run that opened the wait', async () => {
    const workflowId = `${runId}-scoped`;
    const old = await open(workflowId, 'run-1');
    const current = await open(workflowId, 'run-2');
    provider.setState(workflowId, JOB_STATE.TERMINATED, 'run-1');
    expect(await cancelWaitsOfClosedRun(provider, workflowId, 'run-1')).toBe(1);
    expect(await cancelWaitsOfClosedRun(provider, workflowId, 'run-2')).toBe(0);
    expect(await statusOf(old)).toBe('cancelled');
    expect(await statusOf(current)).toBe('pending');
  });

  it('cancels every pending wait of the run and leaves terminal rows as they are', async () => {
    const workflowId = `${runId}-many`;
    const first = await open(workflowId, 'run-1', 'first');
    const second = await open(workflowId, 'run-1', 'second');
    const done = await open(workflowId, 'run-1', 'done');
    await escalationService.resolveEscalation(done, { ok: true });
    expect(await cancelRunWaits(PROVIDER, workflowId, 'run-1')).toBe(2);
    expect(await statusOf(first)).toBe('cancelled');
    expect(await statusOf(second)).toBe('cancelled');
    expect(await statusOf(done)).toBe('resolved');
  });

  it('leaves another provider\'s waits and plain escalations of the same workflow id', async () => {
    const workflowId = `${runId}-shared`;
    const id = await open(workflowId);
    expect(await cancelRunWaits('another-provider', workflowId, '')).toBe(0);
    expect(await statusOf(id)).toBe('pending');
  });

  it('surfaces an engine error', async () => {
    const failing = Object.assign(new FakeDurableProvider(PROVIDER), {
      describe: async () => { throw new Error('engine unavailable'); },
    });
    await expect(cancelWaitsOfClosedRun(failing, `${runId}-err`, '')).rejects.toThrow('engine unavailable');
  });

  it('reports a closed run through the registered provider and cancels its waits', async () => {
    const workflowId = `${runId}-registered`;
    const id = await open(workflowId, 'run-1');
    durableProviderRegistry.register(provider);
    try {
      expect(await cancelWaitsIfRunClosed({ workflow_id: workflowId, run_scope: 'run-1' })).toBe(false);
      provider.setState(workflowId, JOB_STATE.COMPLETED);
      expect(await cancelWaitsIfRunClosed({ workflow_id: workflowId, run_scope: 'run-1' })).toBe(true);
      expect(await statusOf(id)).toBe('cancelled');
    } finally {
      durableProviderRegistry.clear();
    }
  });

  it('counts a run as open when the engine cannot answer', async () => {
    const workflowId = `${runId}-unanswered`;
    const id = await open(workflowId);
    durableProviderRegistry.register(Object.assign(new FakeDurableProvider(PROVIDER), {
      describe: async () => { throw new Error('engine unavailable'); },
    }));
    try {
      expect(await cancelWaitsIfRunClosed({ workflow_id: workflowId, run_scope: '' })).toBe(false);
      expect(await statusOf(id)).toBe('pending');
    } finally {
      durableProviderRegistry.clear();
    }
  });
});
