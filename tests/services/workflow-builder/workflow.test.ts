import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture mock functions
const mockLoadBuilderTools = vi.fn();
const mockCallBuilderLLM = vi.fn();

// Mock HotMesh Durable before importing the workflow
vi.mock('@hotmeshio/hotmesh', () => ({
  Durable: {
    workflow: {
      proxyActivities: () => ({
        loadBuilderTools: mockLoadBuilderTools,
        callBuilderLLM: mockCallBuilderLLM,
      }),
    },
  },
}));

const { mcpWorkflowBuilder } = await import(
  '../../../system/workflows/mcp-workflow-builder/index'
);

describe('mcpWorkflowBuilder', () => {
  const baseEnvelope = {
    data: { prompt: 'Screenshot a webpage and analyze it' },
    metadata: { source: 'test' },
    lt: { userId: 'test-user' },
  };

  const toolsResult = {
    toolIds: ['playwright__capture_page', 'vision__analyze_image'],
    inventory: '• playwright-cli (2 tools): capture_page, extract_content',
    strategy: '',
  };

  const validBuildResult = {
    name: 'screenshot-and-analyze',
    description: 'Takes a screenshot and analyzes it',
    yaml: 'app:\n  id: longtail\n  version: "1"',
    input_schema: { type: 'object', properties: { url: { type: 'string' } } },
    activity_manifest: [
      { activity_id: 'a_t1', title: 'Trigger', type: 'trigger', tool_source: 'trigger', topic: 'test', input_mappings: {}, output_fields: ['url'] },
    ],
    tags: ['screenshots', 'vision'],
    sample_inputs: { url: 'https://example.com' },
  };

  const validLLMResponse = { content: JSON.stringify(validBuildResult) };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadBuilderTools.mockResolvedValue(toolsResult);
  });

  it('returns error when no prompt provided', async () => {
    const result = await mcpWorkflowBuilder({ data: {}, metadata: {}, lt: {} });
    expect(result.type).toBe('return');
    expect(result.data.title).toContain('No prompt');
  });

  it('loads tools and calls LLM with HotMesh-aware prompt', async () => {
    mockCallBuilderLLM.mockResolvedValue(validLLMResponse);

    await mcpWorkflowBuilder(baseEnvelope);

    expect(mockLoadBuilderTools).toHaveBeenCalledOnce();
    expect(mockCallBuilderLLM).toHaveBeenCalledOnce();

    const messages = mockCallBuilderLLM.mock.calls[0][0];
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('@pipe');
    expect(messages[0].content).toContain('playwright-cli');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Screenshot a webpage');
  });

  it('returns workflow YAML on successful build', async () => {
    mockCallBuilderLLM.mockResolvedValue(validLLMResponse);

    const result = await mcpWorkflowBuilder(baseEnvelope);

    expect(result.type).toBe('return');
    expect(result.data.name).toBe('screenshot-and-analyze');
    expect(result.data.yaml).toContain('app:');
    expect(result.data.input_schema).toBeDefined();
    expect(result.data.activity_manifest).toHaveLength(1);
    expect(result.data.tags).toEqual(['screenshots', 'vision']);
    expect(result.data.sample_inputs).toEqual({ url: 'https://example.com' });
    expect(result.data.build_attempts).toBe(1);
  });

  it('includes milestones on success', async () => {
    mockCallBuilderLLM.mockResolvedValue(validLLMResponse);

    const result = await mcpWorkflowBuilder(baseEnvelope);

    expect(result.milestones).toEqual(
      expect.arrayContaining([
        { name: 'workflow_builder', value: 'completed' },
        { name: 'build_attempts', value: '1' },
      ]),
    );
  });

  it('retries on invalid JSON and succeeds on second attempt', async () => {
    mockCallBuilderLLM
      .mockResolvedValueOnce({ content: 'not valid json {{{' })
      .mockResolvedValueOnce(validLLMResponse);

    const result = await mcpWorkflowBuilder(baseEnvelope);

    expect(mockCallBuilderLLM).toHaveBeenCalledTimes(2);
    expect(result.type).toBe('return');
    expect(result.data.name).toBe('screenshot-and-analyze');
    expect(result.data.build_attempts).toBe(2);
  });

  it('retries when response is missing required fields', async () => {
    mockCallBuilderLLM
      .mockResolvedValueOnce({ content: JSON.stringify({ description: 'incomplete' }) })
      .mockResolvedValueOnce(validLLMResponse);

    const result = await mcpWorkflowBuilder(baseEnvelope);

    expect(mockCallBuilderLLM).toHaveBeenCalledTimes(2);
    expect(result.data.name).toBe('screenshot-and-analyze');
  });

  it('returns failure after max attempts exhausted', async () => {
    mockCallBuilderLLM.mockResolvedValue({ content: 'bad json' });

    const result = await mcpWorkflowBuilder(baseEnvelope);

    expect(mockCallBuilderLLM).toHaveBeenCalledTimes(3);
    expect(result.type).toBe('return');
    expect(result.data.title).toContain('Build Failed');
  });

  it('handles LLM response wrapped in markdown fences', async () => {
    mockCallBuilderLLM.mockResolvedValue({
      content: '```json\n' + JSON.stringify(validBuildResult) + '\n```',
    });

    const result = await mcpWorkflowBuilder(baseEnvelope);

    expect(result.data.name).toBe('screenshot-and-analyze');
  });

  it('passes tags to tool loader', async () => {
    mockCallBuilderLLM.mockResolvedValue(validLLMResponse);

    await mcpWorkflowBuilder({
      ...baseEnvelope,
      data: { ...baseEnvelope.data, tags: ['browser-automation'] },
    });

    expect(mockLoadBuilderTools).toHaveBeenCalledWith(['browser-automation']);
  });

  it('injects refinement context when feedback and prior_yaml provided', async () => {
    mockCallBuilderLLM.mockResolvedValue(validLLMResponse);

    await mcpWorkflowBuilder({
      ...baseEnvelope,
      data: {
        ...baseEnvelope.data,
        feedback: 'screenshot_path missing .png',
        prior_yaml: 'app:\n  id: old',
      },
    });

    const messages = mockCallBuilderLLM.mock.calls[0][0];
    expect(messages).toHaveLength(4);
    expect(messages[2].role).toBe('assistant');
    expect(messages[2].content).toContain('prior YAML');
    expect(messages[3].role).toBe('user');
    expect(messages[3].content).toContain('screenshot_path missing .png');
  });

  it('does not inject refinement context without feedback', async () => {
    mockCallBuilderLLM.mockResolvedValue(validLLMResponse);

    await mcpWorkflowBuilder(baseEnvelope);

    const messages = mockCallBuilderLLM.mock.calls[0][0];
    expect(messages).toHaveLength(2); // system + user only
  });
});
