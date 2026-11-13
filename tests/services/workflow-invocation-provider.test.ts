import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Under another provider, an invoke starts the registered workflow on that
// engine with the same envelope HotMesh receives.
const mocks = vi.hoisted(() => ({
  getWorkflowConfig: vi.fn(),
  resolvePrincipal: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('../../services/config', () => ({ getWorkflowConfig: mocks.getWorkflowConfig }));
vi.mock('../../services/user', () => ({ getUser: vi.fn(), getUserByExternalId: vi.fn() }));
vi.mock('../../services/iam/principal', () => ({ resolvePrincipal: mocks.resolvePrincipal }));
vi.mock('../../workers', () => ({ createClient: mocks.createClient }));

import { invokeWorkflow } from '../../services/workflow-invocation';
import { durableProviderRegistry } from '../../services/durable-provider';
import { FakeDurableProvider } from '../helpers/fake-durable-provider';

const ME = '11111111-1111-4111-8111-111111111111';
const CONFIG = { workflow_type: 'reviewOrder', task_queue: 'orders', invocable: true, invocation_roles: [], roles: [], consumes: [] };

let provider: FakeDurableProvider;

beforeEach(() => {
  vi.clearAllMocks();
  provider = new FakeDurableProvider('dbos');
  durableProviderRegistry.register(provider);
  mocks.getWorkflowConfig.mockResolvedValue(CONFIG);
  mocks.resolvePrincipal.mockResolvedValue({ id: ME, type: 'user', roles: [] });
});
afterEach(() => durableProviderRegistry.clear());

const invoke = (options?: Record<string, any>) =>
  invokeWorkflow({ workflowType: 'reviewOrder', data: { orderId: '42' }, metadata: { source: 'test' }, options, auth: { userId: ME } });

describe('invokeWorkflow on a provider', () => {
  it('starts the workflow on the provider with the envelope as its one argument', async () => {
    const { workflowId } = await invoke();
    expect(workflowId).toMatch(/^reviewOrder-/);
    expect(provider.started).toHaveLength(1);
    const [started] = provider.started;
    expect(started).toMatchObject({ workflowType: 'reviewOrder', workflowId, taskQueue: 'orders' });
    expect(started.args).toEqual([{
      data: { orderId: '42' },
      metadata: { source: 'test' },
      lt: expect.objectContaining({ userId: ME, scopes: ['workflow:invoke'] }),
    }]);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('uses the caller workflow id', async () => {
    const { workflowId } = await invoke({ workflowId: 'review-42' });
    expect(workflowId).toBe('review-42');
    expect(provider.started[0].workflowId).toBe('review-42');
  });

  it('needs a registered config, since the engine runs the workers', async () => {
    mocks.getWorkflowConfig.mockResolvedValue(null);
    await expect(invoke()).rejects.toMatchObject({ statusCode: 404, message: expect.stringMatching(/register a config/) });
    expect(provider.started).toHaveLength(0);
  });

  it('refuses a config that is not invocable', async () => {
    mocks.getWorkflowConfig.mockResolvedValue({ ...CONFIG, invocable: false });
    await expect(invoke()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('answers 501 when the provider does not start workflows', async () => {
    (provider.capabilities as { start?: boolean }).start = false;
    await expect(invoke()).rejects.toMatchObject({ statusCode: 501, message: expect.stringMatching(/dbos provider/) });
    expect(provider.started).toHaveLength(0);
  });
});
