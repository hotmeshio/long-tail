import { describe, it, expect, vi, beforeEach } from 'vitest';

// Who a workflow is invoked as over MCP: the /mcp caller, checked against the
// workflow's invocation roles, or lt-system for internal calls.

const mocks = vi.hoisted(() => ({
  invokeWorkflow: vi.fn(async () => ({ workflowId: 'wf-1' })),
  checkInvocationRoles: vi.fn(async () => undefined),
  getWorkflowConfig: vi.fn(async () => ({ workflow_type: 'probe', invocable: true, read_safe: true })),
}));

vi.mock('../../../../services/workflow-invocation', () => ({
  invokeWorkflow: mocks.invokeWorkflow,
  checkInvocationRoles: mocks.checkInvocationRoles,
}));
vi.mock('../../../../services/config', () => ({
  listWorkflowConfigs: vi.fn(async () => []),
  getWorkflowConfig: mocks.getWorkflowConfig,
}));
vi.mock('../../../../services/workers/registry', () => ({
  getRegisteredWorkers: vi.fn(() => new Map()),
  SYSTEM_WORKFLOWS: new Set(),
}));
vi.mock('../../../../api/workflows', () => ({
  getWorkflowStatus: vi.fn(), getWorkflowResult: vi.fn(), terminateWorkflow: vi.fn(),
  checkInvokeInput: vi.fn(async () => null),
}));

import { registerWorkflowTools } from '../../../../system/mcp-servers/admin/workflows';

const CALLER = { userId: '22222222-2222-4222-8222-222222222222', role: 'member', scopes: ['mcp:full'] };
const SYSTEM = { userId: 'lt-system', role: 'superadmin' };
const INVOKE_TOOLS = ['invoke_workflow', 'invoke_workflow_read_safe'];

const tools = new Map<string, (args: any, extra?: any) => Promise<any>>();
registerWorkflowTools({ registerTool: (name: string, _d: unknown, h: any) => tools.set(name, h) } as any);

const invokedAuth = () => (mocks.invokeWorkflow.mock.calls.at(-1) as unknown as [{ auth: unknown }])[0].auth;

beforeEach(() => vi.clearAllMocks());

describe('MCP workflow invocation identity', () => {
  for (const name of INVOKE_TOOLS) {
    it(`${name} checks invocation roles and invokes as the external caller`, async () => {
      await tools.get(name)!({ workflow_type: 'probe', data: {} }, { authInfo: CALLER });
      expect(mocks.checkInvocationRoles).toHaveBeenCalledWith('probe', CALLER.userId, CALLER.role);
      expect(invokedAuth()).toEqual({ userId: CALLER.userId, role: CALLER.role });
    });

    it(`${name} does not invoke when the caller lacks the invocation roles`, async () => {
      mocks.checkInvocationRoles.mockRejectedValueOnce(new Error('Insufficient role for invocation'));
      await expect(tools.get(name)!({ workflow_type: 'probe', data: {} }, { authInfo: CALLER }))
        .rejects.toThrow('Insufficient role for invocation');
      expect(mocks.invokeWorkflow).not.toHaveBeenCalled();
    });

    it(`${name} invokes as lt-system internally without a role check`, async () => {
      await tools.get(name)!({ workflow_type: 'probe', data: {} });
      expect(mocks.checkInvocationRoles).not.toHaveBeenCalled();
      expect(invokedAuth()).toEqual(SYSTEM);
    });
  }

  it('leaves key scopes off, so an mcp:* key is not refused for lacking workflow:invoke', async () => {
    await tools.get('invoke_workflow')!({ workflow_type: 'probe', data: {} }, { authInfo: CALLER });
    expect(invokedAuth()).not.toHaveProperty('scopes');
  });
});
