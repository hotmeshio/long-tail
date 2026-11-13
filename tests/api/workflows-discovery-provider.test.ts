import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Under another provider the registry page lists the registered configs; the
// engine runs its own workers, so HotMesh workers and jobs are not consulted.
const mocks = vi.hoisted(() => ({ listWorkflowConfigs: vi.fn(), query: vi.fn() }));
vi.mock('../../services/config', () => ({ listWorkflowConfigs: mocks.listWorkflowConfigs }));
vi.mock('../../lib/db', () => ({ getPool: () => ({ query: mocks.query }) }));

import { listDiscoveredWorkflows } from '../../api/workflows';
import { durableProviderRegistry } from '../../services/durable-provider';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

describe('discovered workflows on a provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    durableProviderRegistry.register(new FakeDurableProvider('temporal'));
    mocks.listWorkflowConfigs.mockResolvedValue([
      { workflow_type: 'reviewOrder', task_queue: 'orders', invocable: true, certified: false, roles: ['reviewer'], invocation_roles: [], description: 'Review an order' },
    ]);
  });
  afterEach(() => durableProviderRegistry.clear());

  it('lists the registered configs without reading HotMesh jobs', async () => {
    const result = await listDiscoveredWorkflows({});
    expect(result.status).toBe(200);
    expect((result.data as any).workflows).toEqual([expect.objectContaining({
      workflow_type: 'reviewOrder',
      task_queue: 'orders',
      tier: 'registered',
      registered: true,
      active: false,
      invocable: true,
    })]);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
