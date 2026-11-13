import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A workflow schedule under another provider starts the workflow on that
// engine, with the config's envelope, instead of on HotMesh.
const mocks = vi.hoisted(() => ({
  cron: vi.fn(),
  getContext: vi.fn(() => ({ guid: 'tick-1' })),
  durableStart: vi.fn(),
}));
vi.mock('@hotmeshio/hotmesh', async (actual) => {
  const real = await actual<typeof import('@hotmeshio/hotmesh')>();
  return {
    ...real,
    Virtual: { ...real.Virtual, cron: mocks.cron, getContext: mocks.getContext },
    Durable: { ...real.Durable, Client: vi.fn(() => ({ workflow: { start: mocks.durableStart } })) },
  };
});
vi.mock('../../../lib/db', () => ({ getConnection: () => ({}) }));
vi.mock('../../../services/iam/principal', () => ({ resolvePrincipal: vi.fn().mockResolvedValue(null) }));

import { cronRegistry } from '../../../services/cron';
import { durableProviderRegistry } from '../../../services/durable-provider';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';
import type { LTWorkflowConfig } from '../../../types';

const CONFIG = {
  workflow_type: 'reviewOrderRequest',
  task_queue: 'orders',
  cron_schedule: '0 * * * *',
  envelope_schema: { data: { orderId: 'nightly' }, metadata: {} },
  roles: [],
  consumes: [],
} as unknown as LTWorkflowConfig;

async function tick(): Promise<void> {
  await cronRegistry.startCron(CONFIG);
  const { callback } = mocks.cron.mock.calls[0][0];
  await callback();
}

describe('cron on a provider', () => {
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
});
