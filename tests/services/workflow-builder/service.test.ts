import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockStart = vi.fn();
const mockResult = vi.fn();

vi.mock('@hotmeshio/hotmesh', () => ({
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
}));

vi.mock('../../../lib/db', () => ({
  getConnection: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../services/llm', () => ({
  callLLM: vi.fn(),
  hasLLMApiKey: vi.fn().mockReturnValue(false),
}));

import { startMcpQuery, startWorkflowBuilder, describeWorkflow } from '../../../services/insight';
import { callLLM, hasLLMApiKey } from '../../../services/llm';

beforeEach(() => {
  vi.clearAllMocks();
  mockStart.mockResolvedValue({
    result: mockResult.mockResolvedValue({ data: { yaml: 'test' } }),
  });
});

// ── startWorkflowBuilder ─────────────────────────────────────────────────────

describe('startWorkflowBuilder', () => {
  it('returns started status with wait=false', async () => {
    const result = await startWorkflowBuilder({ prompt: 'test prompt', wait: false });

    expect(result.workflow_id).toMatch(/^wf-builder-/);
    expect(result.status).toBe('started');
    expect(result.prompt).toBe('test prompt');
  });

  it('generates unique workflow IDs', async () => {
    const r1 = await startWorkflowBuilder({ prompt: 'a', wait: false });
    const r2 = await startWorkflowBuilder({ prompt: 'b', wait: false });

    expect(r1.workflow_id).not.toBe(r2.workflow_id);
  });

  it('waits for result with wait=true', async () => {
    const result = await startWorkflowBuilder({ prompt: 'build it', wait: true });

    expect(mockResult).toHaveBeenCalledWith({ state: true });
    expect(result.workflow_id).toMatch(/^wf-builder-/);
    expect(result.prompt).toBe('build it');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('passes feedback and prior_yaml to envelope', async () => {
    await startWorkflowBuilder({
      prompt: 'build a workflow',
      tags: ['browser'],
      feedback: 'missing .png',
      prior_yaml: 'old yaml',
      wait: false,
      userId: 'user-123',
    });

    const startCall = mockStart.mock.calls[0][0];
    expect(startCall.workflowName).toBe('mcpWorkflowBuilder');
    expect(startCall.taskQueue).toBe('long-tail-system');
    expect(startCall.entity).toBe('mcpWorkflowBuilder');
    expect(startCall.args[0].data.feedback).toBe('missing .png');
    expect(startCall.args[0].data.prior_yaml).toBe('old yaml');
    expect(startCall.args[0].data.tags).toEqual(['browser']);
    expect(startCall.args[0].lt.userId).toBe('user-123');
  });

  it('passes answers and prior_questions for clarification flow', async () => {
    await startWorkflowBuilder({
      prompt: 'build it',
      answers: 'Use Playwright',
      prior_questions: ['Which browser?'],
      wait: false,
    });

    const startCall = mockStart.mock.calls[0][0];
    expect(startCall.args[0].data.answers).toBe('Use Playwright');
    expect(startCall.args[0].data.prior_questions).toEqual(['Which browser?']);
  });
});

// ── startMcpQuery ────────────────────────────────────────────────────────────

describe('startMcpQuery', () => {
  it('returns started status with wait=false', async () => {
    const result = await startMcpQuery({ prompt: 'find orders', wait: false });

    expect(result.workflow_id).toMatch(/^mcp-query-/);
    expect(result.status).toBe('started');
    expect(result.prompt).toBe('find orders');
  });

  it('uses mcpQuery workflow with direct=true', async () => {
    await startMcpQuery({ prompt: 'test', wait: false, direct: true });

    const startCall = mockStart.mock.calls[0][0];
    expect(startCall.workflowName).toBe('mcpQuery');
    expect(startCall.entity).toBe('mcpQuery');
    expect(startCall.workflowId).toMatch(/^mcp-query-direct-/);
  });

  it('uses mcpQueryRouter workflow with direct=false', async () => {
    await startMcpQuery({ prompt: 'test', wait: false, direct: false });

    const startCall = mockStart.mock.calls[0][0];
    expect(startCall.workflowName).toBe('mcpQueryRouter');
    expect(startCall.entity).toBe('mcpQueryRouter');
    expect(startCall.workflowId).toMatch(/^mcp-query-\d/);
    expect(startCall.workflowId).not.toMatch(/^mcp-query-direct-/);
  });

  it('passes tags and context through envelope', async () => {
    await startMcpQuery({
      prompt: 'test',
      tags: ['analytics'],
      context: { key: 'value' },
      wait: false,
      userId: 'u-1',
    });

    const startCall = mockStart.mock.calls[0][0];
    expect(startCall.args[0].data.tags).toEqual(['analytics']);
    expect(startCall.args[0].data.context).toEqual({ key: 'value' });
    expect(startCall.args[0].lt.userId).toBe('u-1');
  });

  it('waits for result with wait=true', async () => {
    const result = await startMcpQuery({ prompt: 'test', wait: true });

    expect(mockResult).toHaveBeenCalledWith({ state: true });
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('generates unique workflow IDs', async () => {
    const r1 = await startMcpQuery({ prompt: 'a', wait: false });
    const r2 = await startMcpQuery({ prompt: 'b', wait: false });

    expect(r1.workflow_id).not.toBe(r2.workflow_id);
  });
});

// ── describeWorkflow ─────────────────────────────────────────────────────────

describe('describeWorkflow', () => {
  it('returns default when no LLM API key', async () => {
    vi.mocked(hasLLMApiKey).mockReturnValue(false);

    const result = await describeWorkflow({ prompt: 'test query' });

    expect(result.description).toBe('test query');
    expect(result.tags).toEqual([]);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('calls LLM and parses JSON response', async () => {
    vi.mocked(hasLLMApiKey).mockReturnValue(true);
    vi.mocked(callLLM).mockResolvedValue({
      content: '{"tool_name": "Fetch Orders", "description": "Fetches order data", "tags": ["orders", "api"]}',
    } as any);

    const result = await describeWorkflow({ prompt: 'get orders' });

    expect(result.description).toBe('Fetches order data');
    expect(result.tags).toEqual(['orders', 'api']);
    expect(result.tool_name).toBe('fetch-orders');
  });

  it('handles markdown-wrapped JSON response', async () => {
    vi.mocked(hasLLMApiKey).mockReturnValue(true);
    vi.mocked(callLLM).mockResolvedValue({
      content: '```json\n{"tool_name": "Test Tool", "description": "Desc", "tags": ["t"]}\n```',
    } as any);

    const result = await describeWorkflow({ prompt: 'test' });

    expect(result.description).toBe('Desc');
    expect(result.tool_name).toBe('test-tool');
  });

  it('normalizes tool_name to kebab-case', async () => {
    vi.mocked(hasLLMApiKey).mockReturnValue(true);
    vi.mocked(callLLM).mockResolvedValue({
      content: '{"tool_name": "My Cool Tool!!!", "description": "d", "tags": []}',
    } as any);

    const result = await describeWorkflow({ prompt: 'test' });

    expect(result.tool_name).toBe('my-cool-tool');
  });

  it('includes result_title and result_summary in LLM prompt', async () => {
    vi.mocked(hasLLMApiKey).mockReturnValue(true);
    vi.mocked(callLLM).mockResolvedValue({
      content: '{"description": "d", "tags": []}',
    } as any);

    await describeWorkflow({
      prompt: 'test',
      result_title: 'My Title',
      result_summary: 'Summary text',
    });

    const callArgs = vi.mocked(callLLM).mock.calls[0][0];
    const userMsg = callArgs.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toContain('My Title');
    expect(userMsg.content).toContain('Summary text');
  });

  it('returns undefined tool_name when empty', async () => {
    vi.mocked(hasLLMApiKey).mockReturnValue(true);
    vi.mocked(callLLM).mockResolvedValue({
      content: '{"tool_name": "", "description": "d", "tags": []}',
    } as any);

    const result = await describeWorkflow({ prompt: 'test' });

    expect(result.tool_name).toBeUndefined();
  });

  it('defaults tags to empty array when not provided', async () => {
    vi.mocked(hasLLMApiKey).mockReturnValue(true);
    vi.mocked(callLLM).mockResolvedValue({
      content: '{"description": "d"}',
    } as any);

    const result = await describeWorkflow({ prompt: 'test' });

    expect(result.tags).toEqual([]);
  });
});
