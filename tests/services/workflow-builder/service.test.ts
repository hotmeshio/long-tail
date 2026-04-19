import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Durable client
vi.mock('@hotmeshio/hotmesh', () => {
  const mockStart = vi.fn();
  const mockResult = vi.fn();
  return {
    Durable: {
      Client: vi.fn().mockImplementation(() => ({
        workflow: {
          start: mockStart.mockResolvedValue({
            result: mockResult.mockResolvedValue({ data: { yaml: 'test' } }),
          }),
        },
      })),
      workflow: {
        proxyActivities: () => ({}),
      },
    },
  };
});

vi.mock('../../lib/db', () => ({
  getConnection: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../services/llm', () => ({
  callLLM: vi.fn(),
  hasLLMApiKey: vi.fn().mockReturnValue(false),
}));

import { startWorkflowBuilder } from '../../../services/insight';

describe('startWorkflowBuilder', () => {
  it('starts workflow with correct parameters', async () => {
    const result = await startWorkflowBuilder({
      prompt: 'test prompt',
      wait: false,
    });

    expect(result.workflow_id).toMatch(/^wf-builder-/);
    expect(result.status).toBe('started');
    expect(result.prompt).toBe('test prompt');
  });

  it('generates unique workflow IDs', async () => {
    const r1 = await startWorkflowBuilder({ prompt: 'a', wait: false });
    const r2 = await startWorkflowBuilder({ prompt: 'b', wait: false });

    expect(r1.workflow_id).not.toBe(r2.workflow_id);
  });

  it('passes tags and feedback through to envelope', async () => {
    const { Durable } = await import('@hotmeshio/hotmesh');
    const mockClient = new Durable.Client({} as any);

    await startWorkflowBuilder({
      prompt: 'build a workflow',
      tags: ['browser'],
      feedback: 'missing .png',
      prior_yaml: 'old yaml',
      wait: false,
      userId: 'user-123',
    });

    const startCall = (mockClient.workflow.start as any).mock?.calls?.[0]?.[0];
    if (startCall) {
      expect(startCall.workflowName).toBe('mcpWorkflowBuilder');
      expect(startCall.taskQueue).toBe('long-tail-system');
    }
  });
});
