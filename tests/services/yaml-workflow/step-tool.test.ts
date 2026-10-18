import { describe, it, expect, vi, beforeEach } from 'vitest';

// A compiled workflow's built-in tool steps run as the principal the run was
// started for, under each tool's gate; never as lt-system for an invoker.
const mocks = vi.hoisted(() => ({
  callServerTool: vi.fn(async () => ({ external: true })),
  callBuiltinToolAs: vi.fn(async () => ({ as: 'principal' })),
  dispatchBuiltinTool: vi.fn(async () => ({ dispatched: true, result: { as: 'lt-system' } })),
  principal: null as null | { userId: string; access: (gate: string) => Promise<boolean> },
  toolContext: undefined as any,
}));
vi.mock('../../../services/mcp/client', () => ({
  callServerTool: mocks.callServerTool,
  callBuiltinToolAs: mocks.callBuiltinToolAs,
}));
vi.mock('../../../services/mcp/client/connection', () => ({ dispatchBuiltinTool: mocks.dispatchBuiltinTool }));
vi.mock('../../../services/iam/context', () => ({ getToolContext: () => mocks.toolContext }));
vi.mock('../../../api/mcp/tools', () => ({
  builtinServerFor: async (server: string) => (server.startsWith('long-tail') ? server : null),
  builtinToolGate: (_server: string, tool: string) => (tool === 'add_user_role' ? 'superadmin' : 'caller'),
}));
vi.mock('../../../system/workflows/shared/principal-tools', () => ({
  currentToolPrincipal: async () => mocks.principal,
}));

import { callStepTool } from '../../../services/yaml-workflow/workers/step-tool';

const MEMBER = { userId: 'member-uuid', access: async (gate: string) => gate === 'caller' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.principal = null;
  mocks.toolContext = undefined;
});

describe('callStepTool', () => {
  it("a built-in tool the principal's grants do not reach is refused, and its handler never runs", async () => {
    mocks.principal = MEMBER;
    const result = await callStepTool('long-tail-admin', 'add_user_role', { user_id: 'me', role: 'superadmin' });
    expect(result).toEqual({ error: 'add_user_role is not available to this caller' });
    expect(mocks.callBuiltinToolAs).not.toHaveBeenCalled();
    expect(mocks.dispatchBuiltinTool).not.toHaveBeenCalled();
  });

  it('a permitted built-in tool runs as the principal, with its credentials', async () => {
    mocks.principal = MEMBER;
    mocks.toolContext = { principal: { id: 'member-uuid' }, credentials: { delegationToken: 'd1', scopes: [] } };
    expect(await callStepTool('long-tail-admin', 'find_escalations', { status: 'pending' })).toEqual({ as: 'principal' });
    expect(mocks.callBuiltinToolAs).toHaveBeenCalledWith(
      'long-tail-admin', 'find_escalations', { status: 'pending' },
      { userId: 'member-uuid' }, { userId: 'member-uuid', delegationToken: 'd1' },
    );
  });

  it('a run with no principal, started in-process, calls the built-in tool as lt-system', async () => {
    expect(await callStepTool('long-tail-admin', 'add_user_role', {})).toEqual({ as: 'lt-system' });
    expect(mocks.dispatchBuiltinTool).toHaveBeenCalledWith('long-tail-admin', 'add_user_role', {});
  });

  it('a tool on another server is called as before', async () => {
    mocks.principal = MEMBER;
    expect(await callStepTool('remote', 'fetch', { url: 'x' })).toEqual({ external: true });
    expect(mocks.callServerTool).toHaveBeenCalledWith('remote', 'fetch', { url: 'x' });
  });
});
