import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { durableProviderRegistry, engineCanStart, recordFollow, startProviderWorkflow } from '../../../services/durable-provider';
import { FakeDurableProvider } from '../../helpers/fake-durable-provider';

const PROVIDER = 'start-test';
const START = { workflowType: 'reviewOrder', workflowId: 'review-1', taskQueue: 'orders', envelope: { data: { orderId: '1' }, metadata: {} } };

async function followed(workflowId = START.workflowId): Promise<boolean> {
  const { rowCount } = await getPool().query('SELECT 1 FROM lt_durable_follows WHERE provider = $1 AND workflow_id = $2', [PROVIDER, workflowId]);
  return rowCount === 1;
}

describe('starting workflows on a provider', () => {
  beforeAll(async () => { await migrate(); }, 30_000);
  afterEach(async () => {
    durableProviderRegistry.clear();
    await getPool().query('DELETE FROM lt_durable_follows WHERE provider = $1', [PROVIDER]);
  });

  it('HotMesh always starts workflows', () => {
    expect(engineCanStart()).toBe(true);
  });

  it('a provider starts workflows when it declares and implements start', () => {
    durableProviderRegistry.register(new FakeDurableProvider(PROVIDER));
    expect(engineCanStart()).toBe(true);
  });

  it('a provider without the capability does not', () => {
    const provider = new FakeDurableProvider(PROVIDER);
    (provider.capabilities as { start?: boolean }).start = false;
    durableProviderRegistry.register(provider);
    expect(engineCanStart()).toBe(false);
  });

  it('passes the envelope as the one argument', async () => {
    const provider = new FakeDurableProvider(PROVIDER);
    durableProviderRegistry.register(provider);
    await startProviderWorkflow(START);
    expect(provider.started).toEqual([{ workflowType: 'reviewOrder', workflowId: 'review-1', taskQueue: 'orders', args: [START.envelope] }]);
  });

  it('stores the follow before the engine starts the workflow, and keeps it', async () => {
    const provider = new FakeDurableProvider(PROVIDER);
    durableProviderRegistry.register(provider);
    let followedAtStart = false;
    vi.spyOn(provider, 'start').mockImplementation(async () => { followedAtStart = await followed(); });
    await startProviderWorkflow(START);
    expect(followedAtStart).toBe(true);
    expect(await followed()).toBe(true);
  });

  it('removes the follow it stored when the start fails', async () => {
    const provider = new FakeDurableProvider(PROVIDER);
    durableProviderRegistry.register(provider);
    vi.spyOn(provider, 'start').mockRejectedValue(new Error('engine down'));
    await expect(startProviderWorkflow(START)).rejects.toThrow('engine down');
    expect(await followed()).toBe(false);
  });

  it('keeps an earlier follow of the same workflow when a repeat start fails', async () => {
    const provider = new FakeDurableProvider(PROVIDER);
    durableProviderRegistry.register(provider);
    await recordFollow(PROVIDER, START.workflowId, START.workflowType);
    vi.spyOn(provider, 'start').mockRejectedValue(new Error('already started'));
    await expect(startProviderWorkflow(START)).rejects.toThrow('already started');
    expect(await followed()).toBe(true);
  });

  it('throws when the provider does not start workflows', async () => {
    const provider = new FakeDurableProvider(PROVIDER);
    (provider.capabilities as { start?: boolean }).start = false;
    durableProviderRegistry.register(provider);
    await expect(startProviderWorkflow(START)).rejects.toThrow(new RegExp(`${PROVIDER} provider does not start workflows`));
    expect(provider.started).toHaveLength(0);
    expect(await followed()).toBe(false);
  });
});
