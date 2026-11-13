import { describe, it, expect, afterEach } from 'vitest';

import { durableProviderRegistry, engineCanStart, startProviderWorkflow } from '../../../services/durable-provider';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';

const START = { workflowType: 'reviewOrder', workflowId: 'review-1', taskQueue: 'orders', envelope: { data: { orderId: '1' }, metadata: {} } };

describe('starting workflows on a provider', () => {
  afterEach(() => durableProviderRegistry.clear());

  it('HotMesh always starts workflows', () => {
    expect(engineCanStart()).toBe(true);
  });

  it('a provider starts workflows when it declares and implements start', () => {
    durableProviderRegistry.register(new FakeDurableProvider('dbos'));
    expect(engineCanStart()).toBe(true);
  });

  it('a provider without the capability does not', () => {
    const provider = new FakeDurableProvider('temporal');
    (provider.capabilities as { start?: boolean }).start = false;
    durableProviderRegistry.register(provider);
    expect(engineCanStart()).toBe(false);
  });

  it('passes the envelope as the one argument', async () => {
    const provider = new FakeDurableProvider('dbos');
    durableProviderRegistry.register(provider);
    await startProviderWorkflow(START);
    expect(provider.started).toEqual([{ workflowType: 'reviewOrder', workflowId: 'review-1', taskQueue: 'orders', args: [START.envelope] }]);
  });

  it('throws when the provider does not start workflows', async () => {
    const provider = new FakeDurableProvider('temporal');
    (provider.capabilities as { start?: boolean }).start = false;
    durableProviderRegistry.register(provider);
    await expect(startProviderWorkflow(START)).rejects.toThrow(/temporal provider does not start workflows/);
    expect(provider.started).toHaveLength(0);
  });
});
