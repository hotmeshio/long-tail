import { describe, it, expect, vi, beforeEach } from 'vitest';

// OAuth connection tools: a /mcp caller may use their own connections;
// another user's need superadmin. Internal calls are unrestricted.

const mocks = vi.hoisted(() => ({
  resolveCapabilities: vi.fn(async () => ({ superadmin: false })),
  getAccessToken: vi.fn(async () => ({ access_token: 't', expires_at: null, scopes: [], label: 'default' })),
  listConnections: vi.fn(async () => ({ connections: [] })),
  revokeConnection: vi.fn(async () => ({ revoked: true })),
}));

vi.mock('../../../modules/capabilities', () => ({ resolveCapabilities: mocks.resolveCapabilities }));
vi.mock('../../../system/activities/oauth', () => ({
  getAccessToken: mocks.getAccessToken,
  listConnections: mocks.listConnections,
  revokeConnection: mocks.revokeConnection,
}));

import { createOAuthServer } from '../../../system/mcp-servers/oauth';

const CALLER = { userId: '22222222-2222-4222-8222-222222222222', role: 'member' };
const OTHER = '33333333-3333-4333-8333-333333333333';
const CASES: Array<[string, keyof typeof mocks, Record<string, unknown>]> = [
  ['get_access_token', 'getAccessToken', { provider: 'google' }],
  ['list_connections', 'listConnections', {}],
  ['revoke_connection', 'revokeConnection', { provider: 'google' }],
];

let tools: Record<string, { handler: (args: any, extra?: any) => Promise<any> }>;

beforeEach(async () => {
  vi.clearAllMocks();
  tools = (await createOAuthServer() as any)._registeredTools;
});

describe('OAuth connection tools at /mcp', () => {
  for (const [tool, fn, args] of CASES) {
    it(`${tool} serves the caller's own connections`, async () => {
      const result = await tools[tool].handler({ ...args, user_id: CALLER.userId }, { authInfo: CALLER });
      expect(result.isError).toBeFalsy();
      expect(mocks[fn]).toHaveBeenCalled();
    });

    it(`${tool} refuses another user's connections for a non-superadmin`, async () => {
      const result = await tools[tool].handler({ ...args, user_id: OTHER }, { authInfo: CALLER });
      expect(result.isError).toBe(true);
      expect(mocks[fn]).not.toHaveBeenCalled();
    });
  }

  it('a superadmin may use another user\'s connections', async () => {
    mocks.resolveCapabilities.mockResolvedValueOnce({ superadmin: true });
    const result = await tools.get_access_token.handler({ provider: 'google', user_id: OTHER }, { authInfo: CALLER });
    expect(result.isError).toBeFalsy();
    expect(mocks.getAccessToken).toHaveBeenCalled();
  });

  it('internal calls are unrestricted', async () => {
    await tools.get_access_token.handler({ provider: 'google', user_id: OTHER });
    expect(mocks.resolveCapabilities).not.toHaveBeenCalled();
    expect(mocks.getAccessToken).toHaveBeenCalled();
  });
});
