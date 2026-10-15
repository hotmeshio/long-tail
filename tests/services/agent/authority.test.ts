import { describe, it, expect, vi, beforeEach } from 'vitest';

// Automation runs as the identity it names, else lt-system. Configuring it
// needs the caller to be able to run as that identity; automation that would
// run as lt-system, or a capability subscription, is a superadmin's.
const mocks = vi.hoisted(() => ({
  isSuperAdmin: vi.fn(async () => false),
  assertMayActAs: vi.fn(async () => undefined),
  getAgent: vi.fn(),
  getSubscription: vi.fn(),
}));
vi.mock('../../../services/user', () => ({ isSuperAdmin: mocks.isSuperAdmin }));
vi.mock('../../../services/workflow-invocation', async (io) => ({
  ...(await io<any>()), assertMayActAs: mocks.assertMayActAs,
}));
vi.mock('../../../services/agent/index', () => ({ getAgent: mocks.getAgent }));
vi.mock('../../../services/agent/subscriptions', () => ({ getSubscription: mocks.getSubscription }));

import { assertMayConfigureAgent, assertMayConfigureSubscription } from '../../../services/agent/authority';

const ME = 'caller';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSuperAdmin.mockResolvedValue(false);
  mocks.getAgent.mockResolvedValue({ id: 'a1', user_id: null, behaviors: {} });
});

describe('assertMayConfigureAgent', () => {
  it('a superadmin may configure anything', async () => {
    mocks.isSuperAdmin.mockResolvedValue(true);
    await expect(assertMayConfigureAgent(ME, { behaviors: { schedules: [{ cron: '* * * * *' }] } })).resolves.toBeUndefined();
  });

  it('a schedule with no identity runs as lt-system and is refused', async () => {
    await expect(assertMayConfigureAgent(ME, { behaviors: { schedules: [{ cron: '* * * * *' }] } }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('the agent user_id and each schedule identity must pass the act-as rule', async () => {
    await assertMayConfigureAgent(ME, { user_id: 'bot-a', behaviors: { schedules: [{ cron: '* * * * *', execute_as: 'bot-b' }] } });
    expect(mocks.assertMayActAs).toHaveBeenCalledWith(ME, 'bot-a');
    expect(mocks.assertMayActAs).toHaveBeenCalledWith(ME, 'bot-b');
  });

  it('an update is judged against the stored agent', async () => {
    mocks.getAgent.mockResolvedValue({ id: 'a1', user_id: 'stored-bot', behaviors: { schedules: [{ cron: '* * * * *' }] } });
    await assertMayConfigureAgent(ME, { id: 'a1', description: 'x' } as any);
    expect(mocks.assertMayActAs).toHaveBeenCalledWith(ME, 'stored-bot');
  });

  it('an agent with no schedules and no identity is allowed', async () => {
    await expect(assertMayConfigureAgent(ME, {})).resolves.toBeUndefined();
  });
});

describe('assertMayConfigureSubscription', () => {
  it("a capability subscription is a superadmin's", async () => {
    await expect(assertMayConfigureSubscription(ME, { agentId: 'a1', reaction_type: 'capability', execute_as: 'bot' }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('a subscription with no identity, from itself or its agent, is refused', async () => {
    await expect(assertMayConfigureSubscription(ME, { agentId: 'a1', reaction_type: 'durable' }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('a subscription identity must pass the act-as rule; the agent user_id counts', async () => {
    await assertMayConfigureSubscription(ME, { agentId: 'a1', reaction_type: 'durable', execute_as: 'bot' });
    expect(mocks.assertMayActAs).toHaveBeenCalledWith(ME, 'bot');
    mocks.getAgent.mockResolvedValue({ id: 'a1', user_id: 'agent-bot' });
    await assertMayConfigureSubscription(ME, { agentId: 'a1', reaction_type: 'durable' });
    expect(mocks.assertMayActAs).toHaveBeenCalledWith(ME, 'agent-bot');
  });

  it("an update of another agent's subscription is not found", async () => {
    mocks.getSubscription.mockResolvedValue({ id: 's1', agent_id: 'other', reaction_type: 'durable' });
    await expect(assertMayConfigureSubscription(ME, { agentId: 'a1', subscriptionId: 's1' }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('an update keeps the stored reaction type in view', async () => {
    mocks.getSubscription.mockResolvedValue({ id: 's1', agent_id: 'a1', reaction_type: 'capability' });
    await expect(assertMayConfigureSubscription(ME, { agentId: 'a1', subscriptionId: 's1', execute_as: 'bot' }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
