import { describe, it, expect, vi, beforeEach } from 'vitest';

// MCP wiring only — every dependency is mocked.
const mockInvokeWorkflow = vi.fn();
const mockTerminateWorkflow = vi.fn();
const mockGetWorkflowConfig = vi.fn();

vi.mock('../../../../services/workflow-invocation', () => ({
  invokeWorkflow: (...a: unknown[]) => mockInvokeWorkflow(...a),
  checkInvocationRoles: vi.fn(),
}));
vi.mock('../../../../services/config', () => ({
  listWorkflowConfigs: vi.fn().mockResolvedValue([]),
  getWorkflowConfig: (...a: unknown[]) => mockGetWorkflowConfig(...a),
}));
vi.mock('../../../../services/workers/registry', () => ({
  getRegisteredWorkers: vi.fn().mockReturnValue(new Map()),
  SYSTEM_WORKFLOWS: new Set(),
}));
vi.mock('../../../../api/workflows', () => ({
  getWorkflowStatus: vi.fn(),
  getWorkflowResult: vi.fn(),
  terminateWorkflow: (...a: unknown[]) => mockTerminateWorkflow(...a),
}));

import { registerWorkflowTools } from '../../../../system/mcp-servers/admin/workflows';

function captureTools() {
  const handlers = new Map<string, (args: any) => Promise<any>>();
  registerWorkflowTools({
    registerTool(name: string, _def: unknown, handler: (args: any) => Promise<any>) {
      handlers.set(name, handler);
    },
  } as any);
  return handlers;
}

const parse = (result: any) => JSON.parse(result.content[0].text);

let tools: Map<string, (args: any) => Promise<any>>;

beforeEach(() => {
  vi.clearAllMocks();
  tools = captureTools();
});

describe('admin workflow MCP tools', () => {
  it('registers terminate_workflow alongside invoke/status/discovery', () => {
    for (const name of ['list_discovered_workflows', 'invoke_workflow', 'get_workflow_status', 'terminate_workflow']) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it('terminate_workflow calls the complete-kill API (handle + escalations)', async () => {
    mockTerminateWorkflow.mockResolvedValue({ status: 200, data: { terminated: true, workflowId: 'wf-1' } });
    const result = await tools.get('terminate_workflow')!({ workflow_id: 'wf-1' });
    expect(mockTerminateWorkflow).toHaveBeenCalledWith({ workflowId: 'wf-1' });
    expect(parse(result)).toEqual({ terminated: true, workflowId: 'wf-1' });
  });

  it('terminate_workflow surfaces API errors as isError', async () => {
    mockTerminateWorkflow.mockResolvedValue({ status: 404, error: 'not found' });
    const result = await tools.get('terminate_workflow')!({ workflow_id: 'missing' });
    expect(result.isError).toBe(true);
  });

  it('invoke_workflow_read_safe refuses a workflow without the read_safe flag', async () => {
    mockGetWorkflowConfig.mockResolvedValue({ workflow_type: 'lookup', invocable: true, read_safe: false });
    const result = await tools.get('invoke_workflow_read_safe')!({ workflow_type: 'lookup', data: {} });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toBe('workflow lookup is not registered read-safe');
    expect(mockInvokeWorkflow).not.toHaveBeenCalled();
  });

  it('invoke_workflow_read_safe refuses a non-invocable workflow', async () => {
    mockGetWorkflowConfig.mockResolvedValue({ workflow_type: 'lookup', invocable: false, read_safe: true });
    const result = await tools.get('invoke_workflow_read_safe')!({ workflow_type: 'lookup', data: {} });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toBe('workflow lookup is not invocable');
  });

  it('invoke_workflow_read_safe starts an invocable read-safe workflow', async () => {
    mockGetWorkflowConfig.mockResolvedValue({ workflow_type: 'lookup', invocable: true, read_safe: true });
    mockInvokeWorkflow.mockResolvedValue({ workflowId: 'wf-lookup-1' });
    const result = await tools.get('invoke_workflow_read_safe')!({ workflow_type: 'lookup', data: { q: 'x' } });
    expect(parse(result)).toEqual({ workflow_id: 'wf-lookup-1', message: 'Workflow started' });
  });

  it('invoke_workflow forwards WorkflowOptions (deterministic ids ride options.workflowId)', async () => {
    mockInvokeWorkflow.mockResolvedValue({ workflowId: 'pipe-ORD-9' });
    await tools.get('invoke_workflow')!({
      workflow_type: 'orderPipeline',
      data: { orderId: 'ORD-9' },
      options: { workflowId: 'pipe-ORD-9', expire: 3600 },
    });
    expect(mockInvokeWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'orderPipeline',
        options: { workflowId: 'pipe-ORD-9', expire: 3600 },
      }),
    );
  });

  it('invoke_workflow omits options cleanly when the caller sends none', async () => {
    mockInvokeWorkflow.mockResolvedValue({ workflowId: 'auto-1' });
    await tools.get('invoke_workflow')!({ workflow_type: 'orderPipeline', data: {} });
    expect(mockInvokeWorkflow).toHaveBeenCalledWith(expect.objectContaining({ options: undefined }));
  });
});
