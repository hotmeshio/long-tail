import { describe, it, expect, vi, beforeEach } from 'vitest';

// A durable subscription starts its workflow as its run identity, and only
// while that identity may start the workflow.
const mocks = vi.hoisted(() => ({
  invokeWorkflow: vi.fn(async (_input: Record<string, unknown>) => ({ workflowId: 'w' })),
  checkInvocationRoles: vi.fn(async () => undefined),
  publishAgentEvent: vi.fn(),
}));
vi.mock('../../../services/workflow-invocation', () => ({
  invokeWorkflow: mocks.invokeWorkflow,
  checkInvocationRoles: mocks.checkInvocationRoles,
}));
vi.mock('../../../lib/logger', () => ({
  loggerRegistry: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../lib/events/publish', () => ({ publishAgentEvent: mocks.publishAgentEvent }));
vi.mock('../../../services/agent/index', () => ({ updateAgent: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../services/agent/subscriptions', () => ({ listActiveSubscriptions: vi.fn().mockResolvedValue([]) }));

import { agentTriggerRegistry } from '../../../services/agent/trigger-registry';
import type { ActiveSubscription } from '../../../services/agent/subscriptions';
import type { LTEvent } from '../../../types';

const sub = (overrides: Partial<ActiveSubscription> = {}): ActiveSubscription => ({
  id: 'sub-001', agent_id: 'agent', agent_name: 'agent', agent_user_id: 'agent-bot',
  topic: 'workflow.completed', reaction_type: 'durable', workflow_type: 'refundOrder',
  input_mapping: {}, filter: undefined, execute_as: undefined, enabled: true,
  created_at: '2026-01-01', updated_at: '2026-01-01',
  ...overrides,
}) as ActiveSubscription;

const event = { type: 'workflow.completed', source: 'test', timestamp: 't', workflowId: 'wf-1', data: {} } as LTEvent;
const fire = (s: ActiveSubscription) => (agentTriggerRegistry as any).buildHandler(s)(event);

beforeEach(() => vi.clearAllMocks());

describe('durable reaction', () => {
  it('checks the run identity against the workflow before starting it', async () => {
    await fire(sub({ execute_as: 'svc-bot' }));
    expect(mocks.checkInvocationRoles).toHaveBeenCalledWith('refundOrder', 'svc-bot');
    expect(mocks.invokeWorkflow.mock.calls[0][0]).toMatchObject({ workflowType: 'refundOrder', executeAs: 'svc-bot' });
  });

  it("falls back to the agent's user as the run identity", async () => {
    await fire(sub());
    expect(mocks.checkInvocationRoles).toHaveBeenCalledWith('refundOrder', 'agent-bot');
  });

  it('does not start the workflow when the run identity may not', async () => {
    mocks.checkInvocationRoles.mockRejectedValueOnce(Object.assign(new Error('Insufficient role for invocation'), { statusCode: 403 }));
    await fire(sub({ workflow_type: 'capabilityInvoke' }));
    expect(mocks.invokeWorkflow).not.toHaveBeenCalled();
    expect(mocks.publishAgentEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.failed' }));
  });

  it('a subscription with no identity, which only a superadmin configures, starts without a check', async () => {
    await fire(sub({ agent_user_id: undefined }));
    expect(mocks.checkInvocationRoles).not.toHaveBeenCalled();
    expect(mocks.invokeWorkflow).toHaveBeenCalledOnce();
  });
});
