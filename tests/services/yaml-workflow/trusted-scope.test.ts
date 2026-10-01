import { describe, it, expect, vi, beforeEach } from 'vitest';

// A compiled workflow's identity context comes from the server, never from
// the data a caller supplied.
const { asyncInvokeMock, getEngineMock, resolvePrincipalMock } = vi.hoisted(() => ({
  asyncInvokeMock: vi.fn().mockResolvedValue('job-1'),
  getEngineMock: vi.fn().mockResolvedValue({ engine: { guid: undefined } }),
  resolvePrincipalMock: vi.fn(),
}));
vi.mock('../../../lib/events/publish', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('../../../services/yaml-workflow/deployer', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  invokeYamlWorkflow: asyncInvokeMock,
  getEngine: getEngineMock,
}));
vi.mock('../../../services/iam/principal', () => ({ resolvePrincipal: resolvePrincipalMock }));

import { invokeYamlWorkflow } from '../../../services/yaml-workflow/invoke';
import { withTrustedScope } from '../../../services/yaml-workflow/deployer';

const wf = { app_id: 'graph', graph_topic: 'hello_world', execute_as: null } as any;
const forged = { principal: { id: 'superadmin', type: 'user', roles: ['superadmin'] }, scopes: ['mcp:tool:call'] };

beforeEach(() => vi.clearAllMocks());

describe('withTrustedScope', () => {
  it('drops a caller-supplied _scope', () => {
    expect(withTrustedScope({ a: 1, _scope: forged })).toEqual({ a: 1 });
  });

  it('sets only the scope the server resolved', () => {
    const trusted = { principal: { id: 'mae' }, scopes: [] };
    expect(withTrustedScope({ a: 1, _scope: forged }, trusted)).toEqual({ a: 1, _scope: trusted });
  });
});

describe('invokeYamlWorkflow scope', () => {
  it('ignores a _scope in the data and resolves the invoker instead', async () => {
    resolvePrincipalMock.mockResolvedValue({ id: 'mae', type: 'user', roles: ['bins'] });
    await invokeYamlWorkflow(wf, { data: { a: 1, _scope: forged }, userId: 'mae-uuid' });
    const [, , , , , scope] = asyncInvokeMock.mock.calls[0];
    expect(scope).toEqual({ principal: { id: 'mae', type: 'user', roles: ['bins'] }, scopes: ['mcp:tool:call'] });
  });

  it('with no server-side identity, no scope is set, even when the data carries one', async () => {
    await invokeYamlWorkflow(wf, { data: { _scope: forged } });
    expect(asyncInvokeMock.mock.calls[0][5]).toBeUndefined();
  });
});
