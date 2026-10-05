import { describe, it, expect, vi, beforeEach } from 'vitest';

// The REST tool-call route gates a built-in tool by its manifest capability
// for the acting principal, and runs it as that principal, never lt-system.
const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  resolveBuiltinServerName: vi.fn(),
  callBuiltinToolAs: vi.fn(),
  getBuiltinToolManifest: vi.fn(),
  access: vi.fn(),
  assertMayActAs: vi.fn(),
  getUser: vi.fn(),
  getUserByExternalId: vi.fn(),
}));
vi.mock('../../services/mcp', () => ({ mcpRegistry: { current: { callTool: mocks.callTool } } }));
vi.mock('../../services/mcp/client', () => ({
  resolveBuiltinServerName: mocks.resolveBuiltinServerName,
  callBuiltinToolAs: mocks.callBuiltinToolAs,
  getBuiltinToolManifest: mocks.getBuiltinToolManifest,
}));
vi.mock('../../modules/capabilities', () => ({ capabilityAccess: () => mocks.access }));
vi.mock('../../services/user', () => ({ getUser: mocks.getUser, getUserByExternalId: mocks.getUserByExternalId }));
vi.mock('../../services/workflow-invocation', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  assertMayActAs: mocks.assertMayActAs,
}));
vi.mock('../../system', () => ({
  builtinMcpServerFactories: {
    'long-tail-admin': { config: { toolManifest: [{ name: 'list_bot_accounts', gate: 'builder' }, { name: 'find_escalations', gate: 'caller' }] } },
    'example-server': { config: {} },
  },
}));

import { callMcpTool } from '../../api/mcp/tools';
import { InvocationError } from '../../services/workflow-invocation';

const ME = { userId: '11111111-1111-4111-8111-111111111111', role: 'member' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveBuiltinServerName.mockResolvedValue('long-tail-admin');
  mocks.callBuiltinToolAs.mockResolvedValue({ ok: true });
  mocks.getBuiltinToolManifest.mockReturnValue(undefined);
});

describe('callMcpTool on a host-registered server', () => {
  beforeEach(() => {
    mocks.resolveBuiltinServerName.mockResolvedValue('host-slack');
    mocks.getBuiltinToolManifest.mockReturnValue([{ name: 'send_message', gate: 'caller' }, { name: 'purge_channel' }]);
  });

  it('applies the gate the host declared on the tool', async () => {
    mocks.access.mockResolvedValue(true);
    const result = await callMcpTool({ id: 'host-slack', toolName: 'send_message' }, ME);
    expect(mocks.access).toHaveBeenCalledWith('caller');
    expect(result.status).toBe(200);
  });

  it('a host tool without a gate needs builder', async () => {
    mocks.access.mockResolvedValue(false);
    const result = await callMcpTool({ id: 'host-slack', toolName: 'purge_channel' }, ME);
    expect(mocks.access).toHaveBeenCalledWith('builder');
    expect(result.status).toBe(403);
  });
});

describe('callMcpTool on a built-in server', () => {
  it('refuses a tool whose gate the caller lacks, and runs nothing', async () => {
    mocks.access.mockResolvedValue(false);
    const result = await callMcpTool({ id: 'long-tail-admin', toolName: 'list_bot_accounts' }, ME);
    expect(result.status).toBe(403);
    expect(mocks.access).toHaveBeenCalledWith('builder');
    expect(mocks.callBuiltinToolAs).not.toHaveBeenCalled();
  });

  it('runs a permitted tool as the caller', async () => {
    mocks.access.mockResolvedValue(true);
    const result = await callMcpTool({ id: 'some-db-id', toolName: 'find_escalations', arguments: { limit: 1 } }, ME);
    expect(result).toEqual({ status: 200, data: { result: { ok: true } } });
    expect(mocks.access).toHaveBeenCalledWith('caller');
    expect(mocks.callBuiltinToolAs).toHaveBeenCalledWith(
      'long-tail-admin', 'find_escalations', { limit: 1, user_id: ME.userId }, ME,
    );
  });

  it('a built-in tool without a gate needs builder', async () => {
    mocks.resolveBuiltinServerName.mockResolvedValue('example-server');
    mocks.access.mockResolvedValue(false);
    await callMcpTool({ id: 'example-server', toolName: 'anything' }, ME);
    expect(mocks.access).toHaveBeenCalledWith('builder');
  });

  it('execute_as above the caller is refused before any call', async () => {
    mocks.assertMayActAs.mockRejectedValue(new InvocationError('execute_as may not exceed your own authority', 403));
    const result = await callMcpTool({ id: 'long-tail-admin', toolName: 'find_escalations', execute_as: 'superadmin' }, ME);
    expect(result).toEqual({ status: 403, error: 'execute_as may not exceed your own authority' });
    expect(mocks.callBuiltinToolAs).not.toHaveBeenCalled();
  });

  it('an allowed execute_as runs as the target', async () => {
    mocks.assertMayActAs.mockResolvedValue(undefined);
    mocks.getUserByExternalId.mockResolvedValue({ id: 'bot-uuid', roles: [{ role: 'fleet', type: 'member' }] });
    mocks.access.mockResolvedValue(true);
    await callMcpTool({ id: 'long-tail-admin', toolName: 'find_escalations', execute_as: 'fleet-bot' }, ME);
    expect(mocks.callBuiltinToolAs.mock.calls[0][3]).toEqual({ userId: 'bot-uuid', role: 'member' });
  });

  it('an unauthenticated call is refused', async () => {
    expect((await callMcpTool({ id: 'long-tail-admin', toolName: 'find_escalations' })).status).toBe(401);
  });
});

describe('callMcpTool on an external server', () => {
  it('passes through to the adapter with the caller identity', async () => {
    mocks.resolveBuiltinServerName.mockResolvedValue(null);
    mocks.callTool.mockResolvedValue({ remote: true });
    const result = await callMcpTool({ id: 'remote-1', toolName: 'search' }, ME);
    expect(result.status).toBe(200);
    expect(mocks.callTool).toHaveBeenCalledWith('remote-1', 'search', { user_id: ME.userId }, { userId: ME.userId });
    expect(mocks.access).not.toHaveBeenCalled();
  });
});
