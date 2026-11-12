import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The executions list answers from the configured provider when HotMesh does not run the workflows.
const exportListJobs = vi.fn();
vi.mock('../../services/export', () => ({ listJobs: (...a: unknown[]) => exportListJobs(...a) }));

import { listJobs } from '../../api/exports';
import { durableProviderRegistry } from '../../services/durable-provider';
import { JOB_STATE } from '../../types/durable-provider';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

const STARTED = '2026-11-11T10:00:00.000Z';
const CLOSED = '2026-11-11T10:05:00.000Z';

describe('executions list on a provider', () => {
  let provider: FakeDurableProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new FakeDurableProvider('temporal');
    provider.listed = [
      { workflowId: 'order-2', workflowType: 'reviewOrder', state: JOB_STATE.RUNNING, providerState: 'RUNNING', startedAt: STARTED },
      { workflowId: 'order-1', workflowType: 'reviewOrder', state: JOB_STATE.COMPLETED, providerState: 'COMPLETED', startedAt: STARTED, closedAt: CLOSED },
      { workflowId: 'order-0', workflowType: 'reviewOrder', state: JOB_STATE.TERMINATED, providerState: 'TERMINATED', startedAt: STARTED, closedAt: CLOSED },
    ];
    durableProviderRegistry.register(provider);
  });
  afterEach(() => durableProviderRegistry.clear());

  it('returns the provider page in the HotMesh list shape', async () => {
    const result = await listJobs({ limit: 2 });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({
      total: 3,
      jobs: [
        { workflow_id: 'order-2', entity: 'reviewOrder', status: 'running', provider_status: 'RUNNING', is_live: true, created_at: STARTED, updated_at: STARTED },
        { workflow_id: 'order-1', entity: 'reviewOrder', status: 'completed', provider_status: 'COMPLETED', is_live: false, created_at: STARTED, updated_at: CLOSED },
      ],
    });
    expect(exportListJobs).not.toHaveBeenCalled();
  });

  it('shows every unsuccessful close as failed with the engine status kept', async () => {
    const jobs = (await listJobs({ offset: 2 })).data as any;
    expect(jobs.jobs[0]).toMatchObject({ workflow_id: 'order-0', status: 'failed', provider_status: 'TERMINATED' });
  });

  it('passes type, id prefix, state and paging to the provider', async () => {
    await listJobs({ entity: 'reviewOrder', search: 'order-', status: 'running', limit: 500, offset: -4, sort_by: 'updated_at', registered: 'true' });
    expect(provider.listQueries).toEqual([{ limit: 100, offset: 0, workflowType: 'reviewOrder', idPrefix: 'order-', state: 'running' }]);
  });

  it('needs no namespace', async () => {
    expect((await listJobs({})).status).toBe(200);
  });

  it('rejects an unknown status', async () => {
    expect((await listJobs({ status: 'paused' })).status).toBe(400);
    expect(provider.listQueries).toHaveLength(0);
  });

  it('rejects filters with quotes, commas or backslashes', async () => {
    for (const bad of [{ search: "x' OR 1" }, { entity: 'a,b' }, { search: 'a\\b' }]) {
      expect((await listJobs(bad)).status).toBe(400);
    }
    expect(provider.listQueries).toHaveLength(0);
  });

  it('answers 501 when the provider cannot list', async () => {
    durableProviderRegistry.clear();
    durableProviderRegistry.register({
      name: 'bare',
      capabilities: { native: false, execution: false, terminate: false, list: false },
      deliver: vi.fn(),
      describe: vi.fn(),
    });
    expect((await listJobs({})).status).toBe(501);
  });

  it('answers 500 with the engine error', async () => {
    vi.spyOn(provider, 'list').mockRejectedValueOnce(new Error('visibility unavailable'));
    expect(await listJobs({})).toEqual({ status: 500, error: 'visibility unavailable' });
  });

  it('keeps the HotMesh list and its namespace rule on HotMesh', async () => {
    durableProviderRegistry.clear();
    exportListJobs.mockResolvedValue({ jobs: [], total: 0 });
    expect((await listJobs({})).status).toBe(400);
    expect((await listJobs({ app_id: 'durable' })).status).toBe(200);
    expect(exportListJobs).toHaveBeenCalledWith('durable', { app_id: 'durable' });
  });
});
