import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────

const mockCreateYamlWorkflow = vi.fn();
const mockUpdateYamlWorkflow = vi.fn();
const mockCheckTopicConflict = vi.fn().mockResolvedValue(null);
const mockGetYamlWorkflow = vi.fn();

vi.mock('../../services/yaml-workflow/db', () => ({
  createYamlWorkflow: (...args: any[]) => mockCreateYamlWorkflow(...args),
  updateYamlWorkflow: (...args: any[]) => mockUpdateYamlWorkflow(...args),
  checkTopicConflict: (...args: any[]) => mockCheckTopicConflict(...args),
  getYamlWorkflow: (...args: any[]) => mockGetYamlWorkflow(...args),
  getActiveYamlWorkflows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/yaml-workflow/generator', () => ({
  generateYamlFromExecution: vi.fn().mockResolvedValue({
    yaml: 'app:\n  id: test',
    appId: 'longtail',
    graphTopic: 'test_topic',
    inputSchema: {},
    outputSchema: {},
    activityManifest: [
      { mcp_tool_name: 'long_tail_playwright_cli__capture_page', type: 'worker' },
      { mcp_tool_name: 'short_name', type: 'worker' },
    ],
    tags: [],
    inputFieldMeta: {},
  }),
}));

vi.mock('../../services/yaml-workflow/durable-compiler', () => ({
  compileDurableToYaml: vi.fn().mockResolvedValue({
    yaml: 'app:\n  id: test',
    appId: 'longtail',
    graphTopic: 'test_topic',
    inputSchema: {},
    outputSchema: {},
    activityManifest: [
      { mcp_tool_name: 'server_slug__durable_tool', type: 'worker' },
    ],
    tags: [],
    category: 'durable',
  }),
}));

vi.mock('../../services/yaml-workflow/builder-regenerate', () => ({
  rebuildFromPrompt: vi.fn().mockResolvedValue({
    yaml: 'app:\n  id: rebuilt',
    inputSchema: {},
    outputSchema: {},
    activityManifest: [
      { mcp_tool_name: 'srv__rebuilt_tool', type: 'worker' },
    ],
    tags: ['rebuilt'],
  }),
}));

vi.mock('../../services/task', () => ({
  getTaskByWorkflowId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../modules/utils', () => ({
  sanitizeToolName: (s: string) => s.toLowerCase().replace(/[^a-z0-9_.]/g, '_'),
  sanitizeServerName: (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ''),
}));

// ── Import after mocks ──────────────────────────────────────────────

import {
  createYamlWorkflowDirect,
  createYamlWorkflow,
  updateYamlWorkflow,
  regenerateYamlWorkflow,
  createYamlWorkflowFromDurable,
} from '../../api/yaml-workflows/crud';

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateYamlWorkflow.mockImplementation(async (data: any) => ({ id: 'wf-1', ...data }));
  mockUpdateYamlWorkflow.mockImplementation(async (_id: string, data: any) => ({ id: _id, ...data }));
});

describe('normalizeManifestToolNames — write-time normalization', () => {
  describe('createYamlWorkflowDirect', () => {
    it('strips slug__ prefix from mcp_tool_name before persisting', async () => {
      const result = await createYamlWorkflowDirect({
        name: 'test_flow',
        yaml_content: 'app:\n  id: longtail\n  version: "1"\nsubscribes: test_flow',
        activity_manifest: [
          { mcp_tool_name: 'long_tail_playwright_cli__capture_page', type: 'worker' },
          { mcp_tool_name: 'db_server__query_records', type: 'worker' },
        ],
      });

      expect(result.status).toBe(200);
      const persisted = mockCreateYamlWorkflow.mock.calls[0][0];
      expect(persisted.activity_manifest[0].mcp_tool_name).toBe('capture_page');
      expect(persisted.activity_manifest[1].mcp_tool_name).toBe('query_records');
    });

    it('leaves tool names without __ unchanged', async () => {
      await createYamlWorkflowDirect({
        name: 'test_flow',
        yaml_content: 'app:\n  id: longtail\n  version: "1"\nsubscribes: test_flow',
        activity_manifest: [
          { mcp_tool_name: 'capture_page', type: 'worker' },
        ],
      });

      const persisted = mockCreateYamlWorkflow.mock.calls[0][0];
      expect(persisted.activity_manifest[0].mcp_tool_name).toBe('capture_page');
    });

    it('handles undefined activity_manifest gracefully', async () => {
      await createYamlWorkflowDirect({
        name: 'test_flow',
        yaml_content: 'app:\n  id: longtail\n  version: "1"\nsubscribes: test_flow',
      });

      const persisted = mockCreateYamlWorkflow.mock.calls[0][0];
      expect(persisted.activity_manifest).toEqual([]);
    });

    it('handles entries without mcp_tool_name', async () => {
      await createYamlWorkflowDirect({
        name: 'test_flow',
        yaml_content: 'app:\n  id: longtail\n  version: "1"\nsubscribes: test_flow',
        activity_manifest: [
          { type: 'hook', hook_topic: 'some_hook' },
        ],
      });

      const persisted = mockCreateYamlWorkflow.mock.calls[0][0];
      expect(persisted.activity_manifest[0].mcp_tool_name).toBeUndefined();
    });
  });

  describe('createYamlWorkflow (trace compilation)', () => {
    it('normalizes manifest from LLM generator output', async () => {
      const result = await createYamlWorkflow({
        workflow_id: 'exec-1',
        task_queue: 'v1',
        workflow_name: 'test_wf',
        name: 'compiled_flow',
      });

      expect(result.status).toBe(201);
      const persisted = mockCreateYamlWorkflow.mock.calls[0][0];
      // The mock generator returns "long_tail_playwright_cli__capture_page"
      expect(persisted.activity_manifest[0].mcp_tool_name).toBe('capture_page');
      // "short_name" has no __, should be unchanged
      expect(persisted.activity_manifest[1].mcp_tool_name).toBe('short_name');
    });
  });

  describe('updateYamlWorkflow', () => {
    it('normalizes activity_manifest when included in update fields', async () => {
      await updateYamlWorkflow({
        id: 'wf-1',
        activity_manifest: [
          { mcp_tool_name: 'slug__tool_name', type: 'worker' },
        ],
      });

      const updateFields = mockUpdateYamlWorkflow.mock.calls[0][1];
      expect(updateFields.activity_manifest[0].mcp_tool_name).toBe('tool_name');
    });

    it('does not interfere when activity_manifest is absent', async () => {
      await updateYamlWorkflow({
        id: 'wf-1',
        description: 'updated description',
      });

      const updateFields = mockUpdateYamlWorkflow.mock.calls[0][1];
      expect(updateFields.description).toBe('updated description');
      expect(updateFields.activity_manifest).toBeUndefined();
    });
  });

  describe('regenerateYamlWorkflow', () => {
    it('normalizes manifest when recompiling from execution trace', async () => {
      mockGetYamlWorkflow.mockResolvedValue({
        id: 'wf-1',
        name: 'test_flow',
        status: 'draft',
        source_workflow_id: 'exec-1',
        source_workflow_type: 'test_wf',
        app_id: 'longtail',
      });

      const result = await regenerateYamlWorkflow({ id: 'wf-1' });

      expect(result.status).toBe(200);
      const updateFields = mockUpdateYamlWorkflow.mock.calls[0][1];
      expect(updateFields.activity_manifest[0].mcp_tool_name).toBe('capture_page');
    });

    it('normalizes manifest when recompiling from prompt (Plan Build)', async () => {
      mockGetYamlWorkflow.mockResolvedValue({
        id: 'wf-2',
        name: 'plan_flow',
        status: 'draft',
        source_workflow_id: null,
        source_workflow_type: 'mcpWorkflowPlanner',
        app_id: 'longtail',
        original_prompt: 'build a screenshot pipeline',
      });

      const result = await regenerateYamlWorkflow({ id: 'wf-2' });

      expect(result.status).toBe(200);
      const updateFields = mockUpdateYamlWorkflow.mock.calls[0][1];
      expect(updateFields.activity_manifest[0].mcp_tool_name).toBe('rebuilt_tool');
    });
  });

  describe('createYamlWorkflowFromDurable', () => {
    it('normalizes manifest from durable compiler output', async () => {
      const result = await createYamlWorkflowFromDurable({
        source: 'export async function myWorkflow() {}',
        workflow_name: 'myWorkflow',
        name: 'durable_flow',
      });

      expect(result.status).toBe(201);
      const persisted = mockCreateYamlWorkflow.mock.calls[0][0];
      expect(persisted.activity_manifest[0].mcp_tool_name).toBe('durable_tool');
    });
  });
});
