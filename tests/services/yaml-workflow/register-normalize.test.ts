import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────

const mockCallServerTool = vi.fn().mockResolvedValue({ ok: true });
const mockDispatchBuiltinTool = vi.fn().mockResolvedValue(null);
const mockHotMeshInit = vi.fn().mockResolvedValue(undefined);

vi.mock('@hotmeshio/hotmesh', () => ({
  HotMesh: {
    init: (...args: any[]) => mockHotMeshInit(...args),
    guid: () => 'test-guid',
  },
}));

vi.mock('../../../lib/db', () => ({
  getConnection: () => ({ class: 'mock', options: {} }),
}));

vi.mock('../../../lib/logger', () => ({
  loggerRegistry: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../services/iam/ephemeral', () => ({
  exchangeTokensInArgs: vi.fn(async (args: any) => args),
}));

vi.mock('../../../services/mcp/client', () => ({
  callServerTool: (...args: any[]) => mockCallServerTool(...args),
}));

vi.mock('../../../services/mcp/client/connection', () => ({
  dispatchBuiltinTool: (...args: any[]) => mockDispatchBuiltinTool(...args),
}));

vi.mock('../../../services/yaml-workflow/db', () => ({
  getActiveYamlWorkflows: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../services/yaml-workflow/workers/scope', () => ({
  wrapWithScope: (cb: any) => cb,
}));

vi.mock('../../../services/yaml-workflow/workers/events', () => ({
  wrapWithEvents: (_activity: any, _appId: string, _step: number, _total: number, cb: any) => cb,
}));

vi.mock('../../../services/yaml-workflow/workers/callbacks', () => ({
  buildLlmCallback: vi.fn(),
  buildTransformCallback: vi.fn(),
}));

// ── Import after mocks ──────────────────────────────────────────────

import { registerWorkersForWorkflow } from '../../../services/yaml-workflow/workers/register';
import type { LTYamlWorkflowRecord } from '../../../types/yaml-workflow';

// ── Helpers ─────────────────────────────────────────────────────────

function makeWorkflow(activities: any[]): LTYamlWorkflowRecord {
  return {
    id: 'wf-1',
    name: 'test_flow',
    app_id: 'longtail',
    graph_topic: 'test_topic',
    yaml_content: '',
    input_schema: {},
    output_schema: {},
    activity_manifest: activities,
    status: 'active',
    tags: [],
  } as any;
}

function makeStreamData(args: Record<string, unknown> = {}) {
  return {
    metadata: { aid: 'a1', jid: 'j1' },
    data: args,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('register.ts — read-time tool name normalization', () => {
  describe('db tool source', () => {
    it('strips slug__ prefix from mcp_tool_name when calling callServerTool', async () => {
      const workflow = makeWorkflow([
        {
          type: 'worker',
          activity_id: 'a1',
          topic: 'topic_a1',
          tool_source: 'db',
          mcp_tool_name: 'long_tail_db__query_records',
          mcp_server_id: 'long-tail-db',
        },
      ]);

      await registerWorkersForWorkflow(workflow);

      // Extract the callback registered with HotMesh
      const initCall = mockHotMeshInit.mock.calls[0][0];
      const worker = initCall.workers[0];
      expect(worker.topic).toBe('topic_a1');

      // Invoke the callback to verify the tool name passed to callServerTool
      await worker.callback(makeStreamData({ field: 'value' }));

      expect(mockCallServerTool).toHaveBeenCalledOnce();
      expect(mockCallServerTool.mock.calls[0][0]).toBe('long-tail-db');
      expect(mockCallServerTool.mock.calls[0][1]).toBe('query_records');
    });

    it('leaves short tool names unchanged for db tools', async () => {
      const workflow = makeWorkflow([
        {
          type: 'worker',
          activity_id: 'a1',
          topic: 'topic_a1',
          tool_source: 'db',
          mcp_tool_name: 'query_records',
          mcp_server_id: 'long-tail-db',
        },
      ]);

      await registerWorkersForWorkflow(workflow);

      const initCall = mockHotMeshInit.mock.calls[0][0];
      await initCall.workers[0].callback(makeStreamData({}));

      expect(mockCallServerTool.mock.calls[0][1]).toBe('query_records');
    });
  });

  describe('mcp tool source', () => {
    it('strips slug__ prefix from mcp_tool_name when calling dispatchBuiltinTool and callServerTool', async () => {
      const workflow = makeWorkflow([
        {
          type: 'worker',
          activity_id: 'a1',
          topic: 'topic_a1',
          tool_source: 'mcp',
          mcp_tool_name: 'long_tail_playwright_cli__capture_page',
          mcp_server_id: 'long-tail-playwright-cli',
        },
      ]);

      await registerWorkersForWorkflow(workflow);

      const initCall = mockHotMeshInit.mock.calls[0][0];
      await initCall.workers[0].callback(makeStreamData({ url: 'https://example.com' }));

      // dispatchBuiltinTool is tried first with the short name
      expect(mockDispatchBuiltinTool).toHaveBeenCalledOnce();
      expect(mockDispatchBuiltinTool.mock.calls[0][1]).toBe('capture_page');

      // Falls through to callServerTool since dispatchBuiltinTool returned null
      expect(mockCallServerTool).toHaveBeenCalledOnce();
      expect(mockCallServerTool.mock.calls[0][1]).toBe('capture_page');
    });

    it('uses short name when dispatchBuiltinTool finds a builtin', async () => {
      mockDispatchBuiltinTool.mockResolvedValueOnce({ result: { screenshot: 'base64...' } });

      const workflow = makeWorkflow([
        {
          type: 'worker',
          activity_id: 'a1',
          topic: 'topic_a1',
          tool_source: 'mcp',
          mcp_tool_name: 'srv__take_screenshot',
          mcp_server_id: 'srv',
        },
      ]);

      await registerWorkersForWorkflow(workflow);

      const initCall = mockHotMeshInit.mock.calls[0][0];
      await initCall.workers[0].callback(makeStreamData({}));

      expect(mockDispatchBuiltinTool.mock.calls[0][1]).toBe('take_screenshot');
      // callServerTool should NOT be called when builtin dispatches
      expect(mockCallServerTool).not.toHaveBeenCalled();
    });

    it('leaves short tool names unchanged for mcp tools', async () => {
      const workflow = makeWorkflow([
        {
          type: 'worker',
          activity_id: 'a1',
          topic: 'topic_a1',
          tool_source: 'mcp',
          mcp_tool_name: 'capture_page',
          mcp_server_id: 'long-tail-playwright-cli',
        },
      ]);

      await registerWorkersForWorkflow(workflow);

      const initCall = mockHotMeshInit.mock.calls[0][0];
      await initCall.workers[0].callback(makeStreamData({}));

      expect(mockDispatchBuiltinTool.mock.calls[0][1]).toBe('capture_page');
    });
  });
});
