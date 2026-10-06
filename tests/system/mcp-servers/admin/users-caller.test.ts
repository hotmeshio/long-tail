import { describe, it, expect, vi, beforeEach } from 'vitest';

// add_user_role applies the REST grant rule to a /mcp caller.

const mocks = vi.hoisted(() => ({
  mayGrantRole: vi.fn(async () => ({ allowed: true as const })),
  addUserRole: vi.fn(async () => ({ role: 'reviewer', type: 'member' })),
}));

vi.mock('../../../../modules/capabilities', () => ({ mayGrantRole: mocks.mayGrantRole }));
vi.mock('../../../../services/user', async (io) => ({
  ...(await io<typeof import('../../../../services/user')>()),
  addUserRole: mocks.addUserRole,
}));
vi.mock('../../../../services/role', () => ({ listRoles: vi.fn(), createRole: vi.fn(), addEscalationChain: vi.fn() }));

import { registerUserTools } from '../../../../system/mcp-servers/admin/users';

const CALLER = { userId: '22222222-2222-4222-8222-222222222222', role: 'admin' };
const TARGET = '33333333-3333-4333-8333-333333333333';
const tools = new Map<string, (args: any, extra?: any) => Promise<any>>();
registerUserTools({ registerTool: (name: string, _d: unknown, h: any) => tools.set(name, h) } as any);
const addRole = (args: Record<string, unknown>, extra?: unknown) => tools.get('add_user_role')!({ user_id: TARGET, ...args }, extra);

beforeEach(() => vi.clearAllMocks());

describe('add_user_role grant rule at /mcp', () => {
  it('checks the external caller against the grant rule before assigning', async () => {
    await addRole({ role: 'reviewer', type: 'member' }, { authInfo: CALLER });
    expect(mocks.mayGrantRole).toHaveBeenCalledWith(CALLER.userId, { role: 'reviewer', type: 'member' });
    expect(mocks.addUserRole).toHaveBeenCalledWith(TARGET, 'reviewer', 'member', expect.anything());
  });

  it('refuses a grant the caller may not make', async () => {
    mocks.mayGrantRole.mockResolvedValueOnce({ allowed: false, error: 'Only superadmin can assign superadmin role type' } as any);
    const result = await addRole({ role: 'reviewer', type: 'superadmin' }, { authInfo: CALLER });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({ error: 'Only superadmin can assign superadmin role type' });
    expect(mocks.addUserRole).not.toHaveBeenCalled();
  });

  it('skips the grant rule for internal calls', async () => {
    await addRole({ role: 'reviewer', type: 'member' });
    expect(mocks.mayGrantRole).not.toHaveBeenCalled();
    expect(mocks.addUserRole).toHaveBeenCalled();
  });
});
