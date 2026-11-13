import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A scheduled run starts on the provider, or on HotMesh, with the config's
// envelope and an id derived from the tick.
const mocks = vi.hoisted(() => ({
  durableStart: vi.fn(),
  resolvePrincipal: vi.fn().mockResolvedValue(null),
}));
vi.mock('@hotmeshio/hotmesh', async (actual) => {
  const real = await actual<typeof import('@hotmeshio/hotmesh')>();
  return {
    ...real,
    Durable: { ...real.Durable, Client: vi.fn(() => ({ workflow: { start: mocks.durableStart } })) },
  };
});
vi.mock('../../../lib/db', () => ({ getConnection: () => ({}) }));
vi.mock('../../../services/iam/principal', () => ({ resolvePrincipal: mocks.resolvePrincipal }));

import { buildCronEnvelope, startScheduledRun } from '../../../services/cron/workflow-run';
import { durableProviderRegistry } from '../../../services/durable-provider';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';
import { getRegisteredWorkers, registerWorker } from '../../../services/workers/registry';
import type { LTWorkflowConfig } from '../../../types';

const CONFIG = {
  workflow_type: 'reviewOrderRequest',
  task_queue: 'orders',
  cron_schedule: '0 * * * *',
  envelope_schema: { data: { orderId: 'nightly' }, metadata: {} },
  roles: [],
  consumes: [],
} as unknown as LTWorkflowConfig;

const SYSTEM = { id: 'sys-1', type: 'bot' } as any;
const tick = () => startScheduledRun(CONFIG, 'tick-1', null);

describe('starting a scheduled run', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => durableProviderRegistry.clear());

  it('starts the workflow on the provider with the config envelope', async () => {
    const provider = new FakeDurableProvider('dbos');
    durableProviderRegistry.register(provider);
    await tick();
    expect(provider.started).toEqual([{
      workflowType: 'reviewOrderRequest',
      workflowId: 'reviewOrderRequest-cron-tick-1',
      taskQueue: 'orders',
      args: [expect.objectContaining({ data: { orderId: 'nightly' }, metadata: { source: 'cron' }, lt: { scopes: ['workflow:cron'] } })],
    }]);
    expect(mocks.durableStart).not.toHaveBeenCalled();
  });

  it('starts the workflow on HotMesh when no provider is registered', async () => {
    await tick();
    expect(mocks.durableStart).toHaveBeenCalledWith(expect.objectContaining({
      workflowName: 'reviewOrderRequest',
      workflowId: 'reviewOrderRequest-cron-tick-1',
      taskQueue: 'orders',
    }));
  });

  it('starts Long Tail\'s own HotMesh workflow on HotMesh under a provider', async () => {
    const provider = new FakeDurableProvider('dbos');
    durableProviderRegistry.register(provider);
    registerWorker('reviewOrderRequest', 'orders');
    try {
      await tick();
      expect(mocks.durableStart).toHaveBeenCalled();
      expect(provider.started).toHaveLength(0);
    } finally {
      getRegisteredWorkers().delete('reviewOrderRequest');
    }
  });

  it('marks the source and runs as the system principal by default', async () => {
    const envelope = await buildCronEnvelope(CONFIG, SYSTEM);
    expect(envelope.metadata).toEqual({ source: 'cron' });
    expect(envelope.lt).toEqual({ userId: 'sys-1', principal: SYSTEM, scopes: ['workflow:cron'] });
  });

  it('runs as the configured principal when execute_as resolves', async () => {
    const bot = { id: 'bot-9', type: 'bot' };
    mocks.resolvePrincipal.mockResolvedValueOnce(bot);
    const envelope = await buildCronEnvelope({ ...CONFIG, execute_as: 'nightly-bot' } as LTWorkflowConfig, SYSTEM);
    expect(mocks.resolvePrincipal).toHaveBeenCalledWith('nightly-bot');
    expect(envelope.lt.principal).toBe(bot);
  });

  it('leaves the stored envelope schema unchanged', async () => {
    await buildCronEnvelope(CONFIG, SYSTEM);
    expect(CONFIG.envelope_schema).toEqual({ data: { orderId: 'nightly' }, metadata: {} });
  });
});
