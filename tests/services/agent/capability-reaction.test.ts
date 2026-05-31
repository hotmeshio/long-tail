import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

// Track invokeWorkflow calls to verify capability dispatch
const invokeWorkflowMock = vi.fn().mockResolvedValue({});

vi.mock('../../../services/workflow-invocation', () => ({
  invokeWorkflow: (...args: any[]) => invokeWorkflowMock(...args),
}));

vi.mock('../../../lib/logger', () => ({
  loggerRegistry: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../lib/events/publish', () => ({
  publishAgentEvent: vi.fn(),
}));

vi.mock('../../../services/agent/index', () => ({
  updateAgent: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../services/agent/subscriptions', () => ({
  listActiveSubscriptions: vi.fn().mockResolvedValue([]),
}));

// ── Imports (after mocks) ────────────────────────────────────────────

import { agentTriggerRegistry } from '../../../services/agent/trigger-registry';
import { applyInputMapping } from '../../../services/agent/input-mapper';
import type { ActiveSubscription } from '../../../services/agent/subscriptions';
import type { LTEvent } from '../../../types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeCapabilitySub(overrides?: Partial<ActiveSubscription>): ActiveSubscription {
  return {
    id: 'sub-001',
    agent_id: 'test-agent',
    agent_name: 'test-agent',
    agent_user_id: 'agent-bot',
    topic: 'workflow.completed',
    reaction_type: 'capability',
    server_id: 'srv-gmail-001',
    tool_name: 'gmail_send',
    input_mapping: {
      data: {
        to: '{event.data.email}',
        subject: 'Workflow completed: {event.workflowId}',
      },
    },
    filter: undefined,
    execute_as: undefined,
    enabled: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<LTEvent>): LTEvent {
  return {
    type: 'workflow.completed',
    source: 'test',
    timestamp: '2026-01-01T00:00:00Z',
    workflowId: 'wf-123',
    workflowName: 'myWorkflow',
    taskQueue: 'test-queue',
    data: { email: 'user@example.com', status: 'ok' },
    ...overrides,
  } as LTEvent;
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  invokeWorkflowMock.mockClear();
});

describe('capability reaction — trigger registry dispatch', () => {
  it('invokes capabilityInvoke workflow with correct serverId, toolName, and mapped arguments', async () => {
    const sub = makeCapabilitySub();
    const event = makeEvent();

    // Access the private buildHandler via the class — we simulate what the registry does
    const handler = (agentTriggerRegistry as any).buildHandler(sub);
    await handler(event);

    expect(invokeWorkflowMock).toHaveBeenCalledOnce();
    const call = invokeWorkflowMock.mock.calls[0][0];

    expect(call.workflowType).toBe('capabilityInvoke');
    expect(call.data.serverId).toBe('srv-gmail-001');
    expect(call.data.toolName).toBe('gmail_send');
    expect(call.data.arguments.to).toBe('user@example.com');
    expect(call.metadata).toEqual({ source: 'agent', certified: true });
  });

  it('uses deterministic workflow ID for idempotent execution', async () => {
    const sub = makeCapabilitySub();
    const event = makeEvent({ workflowId: 'wf-abc' });

    const handler = (agentTriggerRegistry as any).buildHandler(sub);
    await handler(event);
    await handler(event);

    // Both calls should produce the same deterministic ID
    const id1 = invokeWorkflowMock.mock.calls[0][0].options.workflowId;
    const id2 = invokeWorkflowMock.mock.calls[1][0].options.workflowId;
    expect(id1).toBe(id2);
    expect(id1).toContain('agent-test-agent');
    expect(id1).toContain('wf-abc');
  });

  it('passes execute_as from subscription when configured', async () => {
    const sub = makeCapabilitySub({ execute_as: 'service-account-1' });
    const event = makeEvent();

    const handler = (agentTriggerRegistry as any).buildHandler(sub);
    await handler(event);

    const call = invokeWorkflowMock.mock.calls[0][0];
    expect(call.executeAs).toBe('service-account-1');
  });

  it('falls back to agent_user_id when execute_as is not set', async () => {
    const sub = makeCapabilitySub({ execute_as: undefined, agent_user_id: 'bot-user' });
    const event = makeEvent();

    const handler = (agentTriggerRegistry as any).buildHandler(sub);
    await handler(event);

    const call = invokeWorkflowMock.mock.calls[0][0];
    expect(call.executeAs).toBe('bot-user');
  });

  it('skips invocation when filter does not match', async () => {
    const sub = makeCapabilitySub({ filter: { status: 'error' } });
    const event = makeEvent({ data: { status: 'ok' } });

    const handler = (agentTriggerRegistry as any).buildHandler(sub);
    await handler(event);

    expect(invokeWorkflowMock).not.toHaveBeenCalled();
  });

  it('invokes when filter matches', async () => {
    const sub = makeCapabilitySub({ filter: { status: 'ok' } });
    const event = makeEvent({ data: { status: 'ok', email: 'test@x.com' } });

    const handler = (agentTriggerRegistry as any).buildHandler(sub);
    await handler(event);

    expect(invokeWorkflowMock).toHaveBeenCalledOnce();
  });

  it('uses raw event data when no input_mapping is configured', async () => {
    const sub = makeCapabilitySub({ input_mapping: {} });
    const event = makeEvent({ data: { foo: 'bar' } });

    const handler = (agentTriggerRegistry as any).buildHandler(sub);
    await handler(event);

    const call = invokeWorkflowMock.mock.calls[0][0];
    // When no mapping, default envelope is { data: {...}, metadata: {...} }
    // The capability case extracts mapped.data as arguments
    expect(call.data.arguments).toEqual({ foo: 'bar' });
  });
});

describe('capability reaction — input mapping', () => {
  it('resolves {event.data.*} templates', () => {
    const mapping = {
      data: {
        recipient: '{event.data.email}',
        wfId: '{event.workflowId}',
      },
    };
    const event = makeEvent();
    const result = applyInputMapping(mapping, event);
    expect(result.data.recipient).toBe('user@example.com');
    expect(result.data.wfId).toBe('wf-123');
  });

  it('preserves static values alongside templates', () => {
    const mapping = {
      data: {
        subject: 'Alert!',
        source: '{event.source}',
      },
    };
    const event = makeEvent();
    const result = applyInputMapping(mapping, event);
    expect(result.data.subject).toBe('Alert!');
    expect(result.data.source).toBe('test');
  });

  it('returns raw template when path does not exist', () => {
    const mapping = { data: { x: '{event.data.nonexistent}' } };
    const event = makeEvent();
    const result = applyInputMapping(mapping, event);
    expect(result.data.x).toBe('{event.data.nonexistent}');
  });
});
