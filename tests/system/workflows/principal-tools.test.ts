import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tools an LLM chooses run with the authority of the workflow's principal:
// gated by the tool's manifest capability and dispatched as that principal.
const mocks = vi.hoisted(() => ({
  ctx: null as any,
  getUserByExternalId: vi.fn(),
  access: vi.fn(),
  builtinServerFor: vi.fn(),
  callBuiltinToolAs: vi.fn(async () => ({ ok: 'as-principal' })),
  callServerTool: vi.fn(async () => ({ ok: 'lt-system-path' })),
  listMcpServers: vi.fn(async () => ({ servers: [{ name: 'long-tail-admin', tags: [], tool_manifest: [{ name: 'list_bot_accounts' }, { name: 'find_escalations' }] }] })),
}));
vi.mock('../../../services/iam/context', () => ({ getToolContext: () => mocks.ctx }));
vi.mock('../../../services/user', () => ({ getUser: vi.fn(), getUserByExternalId: mocks.getUserByExternalId }));
vi.mock('../../../modules/capabilities', () => ({ capabilityAccess: () => mocks.access }));
vi.mock('../../../api/mcp/tools', () => ({
  builtinServerFor: mocks.builtinServerFor,
  builtinToolGate: (_s: string, tool: string) => (tool === 'list_bot_accounts' ? 'builder' : 'caller'),
}));
vi.mock('../../../services/mcp/client', () => ({ callBuiltinToolAs: mocks.callBuiltinToolAs, callServerTool: mocks.callServerTool }));
vi.mock('../../../services/mcp/db', () => ({ listMcpServers: mocks.listMcpServers, findServersByTags: vi.fn() }));
vi.mock('../../../services/iam/ephemeral', () => ({ exchangeTokensInArgs: vi.fn(async (a: unknown) => a) }));
vi.mock('../../../services/yaml-workflow/db', () => ({}));
vi.mock('../../../services/yaml-workflow/deployer', () => ({}));
vi.mock('../../../system/workflows/shared/strategy-advisors', () => ({ generateStrategySection: () => '' }));

import { callTool } from '../../../system/workflows/shared/tool-executor';
import { loadToolsFromServers } from '../../../system/workflows/shared/tool-loader';

const MEMBER = { id: 'mae', type: 'user', roles: ['bins'] };
const caches = () => ({ toolServerMap: new Map([['long_tail_admin__list_bot_accounts', 'long-tail-admin'], ['long_tail_admin__find_escalations', 'long-tail-admin']]), yamlWorkflowMap: new Map() });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx = { principal: MEMBER, credentials: { delegationToken: 'dt', scopes: [] } };
  mocks.getUserByExternalId.mockResolvedValue({ id: 'mae-uuid' });
  mocks.builtinServerFor.mockResolvedValue('long-tail-admin');
  mocks.access.mockImplementation(async (gate: string) => gate === 'caller');
});

describe('callTool for a workflow principal', () => {
  it('refuses a tool whose gate the principal lacks', async () => {
    const result = await callTool('long_tail_admin__list_bot_accounts', {}, caches());
    expect(result).toMatchObject({ error: 'list_bot_accounts is not available to this caller' });
    expect(mocks.callBuiltinToolAs).not.toHaveBeenCalled();
    expect(mocks.callServerTool).not.toHaveBeenCalled();
  });

  it('runs a permitted tool as the principal, keeping its credentials', async () => {
    const result = await callTool('long_tail_admin__find_escalations', { limit: 1 }, caches());
    expect(result).toEqual({ ok: 'as-principal' });
    expect(mocks.callBuiltinToolAs).toHaveBeenCalledWith(
      'long-tail-admin', 'find_escalations', { limit: 1 }, { userId: 'mae-uuid' }, { userId: 'mae', delegationToken: 'dt' },
    );
  });

  it('a workflow with no principal keeps the internal path', async () => {
    mocks.ctx = null;
    expect(await callTool('long_tail_admin__list_bot_accounts', {}, caches())).toEqual({ ok: 'lt-system-path' });
  });
});

describe('loadToolsFromServers for a workflow principal', () => {
  it('lists only the tools the principal may call', async () => {
    const { toolIds } = await loadToolsFromServers(undefined, { toolServerMap: new Map(), toolDefCache: new Map() });
    expect(toolIds).toEqual(['long_tail_admin__find_escalations']);
  });

  it('with no principal, every tool', async () => {
    mocks.ctx = null;
    const { toolIds } = await loadToolsFromServers(undefined, { toolServerMap: new Map(), toolDefCache: new Map() });
    expect(toolIds).toHaveLength(2);
  });

  it('an external server\'s tools are a builder\'s: refused for anyone else, listed and run for a builder', async () => {
    mocks.builtinServerFor.mockResolvedValue(null);
    const external = () => ({ toolServerMap: new Map([['remote_longtail__find_escalations', 'remote-longtail']]), yamlWorkflowMap: new Map() });
    const refused = await callTool('remote_longtail__find_escalations', {}, external());
    expect(refused).toMatchObject({ error: expect.stringContaining('not available') });
    expect(mocks.callServerTool).not.toHaveBeenCalled();

    mocks.access.mockImplementation(async () => true);
    await callTool('remote_longtail__find_escalations', {}, external());
    expect(mocks.callServerTool).toHaveBeenCalled();
  });
});
