import { describe, it, expect, vi, beforeEach } from 'vitest';

// User and bot account tools apply the account rules to a /mcp caller and
// leave internal calls (lt-system) as they were.
const mocks = vi.hoisted(() => ({
  mayGrantRole: vi.fn(async () => ({ allowed: true as const })),
  mayGrantRoles: vi.fn(async () => ({ allowed: true as const })),
  mayManageAccount: vi.fn(async () => ({ allowed: true as const })),
  mayRevokeRole: vi.fn(async () => ({ allowed: true as const })),
  createUser: vi.fn(async () => ({ id: 'u-new' })),
  removeUserRole: vi.fn(async () => true),
  createBot: vi.fn(async () => ({ status: 201, data: { id: 'b-new' } })),
  createBotKey: vi.fn(async () => ({ status: 201, data: { key: 'lt_bot_x' } })),
  revokeBotKey: vi.fn(async () => ({ status: 200, data: { revoked: true } })),
  getBotApiKeyOwner: vi.fn(async () => 'bot-owner'),
}));

vi.mock('../../../../modules/capabilities', () => ({
  mayGrantRole: mocks.mayGrantRole, mayGrantRoles: mocks.mayGrantRoles,
  mayManageAccount: mocks.mayManageAccount, mayRevokeRole: mocks.mayRevokeRole,
}));
vi.mock('../../../../services/user', async (io) => ({
  ...(await io<typeof import('../../../../services/user')>()),
  createUser: mocks.createUser, removeUserRole: mocks.removeUserRole,
}));
vi.mock('../../../../services/role', () => ({ listRoles: vi.fn(), createRole: vi.fn(), addEscalationChain: vi.fn() }));
vi.mock('../../../../api/bot-accounts', () => ({
  createBot: mocks.createBot, createBotKey: mocks.createBotKey, revokeBotKey: mocks.revokeBotKey,
  listBots: vi.fn(), getBot: vi.fn(), updateBot: vi.fn(async () => ({ status: 200, data: {} })), deleteBot: vi.fn(async () => ({ status: 200, data: {} })),
}));
vi.mock('../../../../services/auth/bot-api-key', () => ({ getBotApiKeyOwner: mocks.getBotApiKeyOwner }));

import { registerUserTools } from '../../../../system/mcp-servers/admin/users';
import { registerBotAccountTools } from '../../../../system/mcp-servers/admin/bot-accounts';

const CALLER = { authInfo: { userId: '22222222-2222-4222-8222-222222222222', role: 'member' } };
const tools = new Map<string, (args: any, extra?: any) => Promise<any>>();
const capture = { registerTool: (name: string, _d: unknown, h: any) => tools.set(name, h) } as any;
registerUserTools(capture);
registerBotAccountTools(capture);
const refuse = { allowed: false as const, error: 'Only superadmin can change a superadmin account' };

beforeEach(() => vi.clearAllMocks());

describe('account rules at /mcp', () => {
  it('create_user checks every role for a /mcp caller, and refuses on a denial', async () => {
    const roles = [{ role: 'ops', type: 'superadmin' }];
    mocks.mayGrantRoles.mockResolvedValueOnce(refuse as any);
    const result = await tools.get('create_user')!({ external_id: 'x', roles }, CALLER);
    expect(result.isError).toBe(true);
    expect(mocks.mayGrantRoles).toHaveBeenCalledWith(CALLER.authInfo.userId, roles);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it('create_user internally runs unchecked, as lt-system did', async () => {
    await tools.get('create_user')!({ external_id: 'x', roles: [] });
    expect(mocks.mayGrantRoles).not.toHaveBeenCalled();
    expect(mocks.createUser).toHaveBeenCalled();
  });

  it('remove_user_role applies the revoke rule', async () => {
    mocks.mayRevokeRole.mockResolvedValueOnce(refuse as any);
    const result = await tools.get('remove_user_role')!({ user_id: 'u1', role: 'ops' }, CALLER);
    expect(result.isError).toBe(true);
    expect(mocks.removeUserRole).not.toHaveBeenCalled();
  });

  it('create_bot_account checks its roles', async () => {
    mocks.mayGrantRoles.mockResolvedValueOnce(refuse as any);
    expect((await tools.get('create_bot_account')!({ name: 'b', roles: [{ role: 'ops', type: 'superadmin' }] }, CALLER)).isError).toBe(true);
    expect(mocks.createBot).not.toHaveBeenCalled();
  });

  it('create_bot_api_key and revoke_bot_api_key check the bot account', async () => {
    mocks.mayManageAccount.mockResolvedValue(refuse as any);
    expect((await tools.get('create_bot_api_key')!({ id: 'b1', name: 'k' }, CALLER)).isError).toBe(true);
    expect((await tools.get('revoke_bot_api_key')!({ key_id: 'k1' }, CALLER)).isError).toBe(true);
    expect(mocks.mayManageAccount).toHaveBeenCalledWith(CALLER.authInfo.userId, 'bot-owner');
    expect(mocks.createBotKey).not.toHaveBeenCalled();
    expect(mocks.revokeBotKey).not.toHaveBeenCalled();
    mocks.mayManageAccount.mockResolvedValue({ allowed: true });
  });
});
