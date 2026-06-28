import { describe, it, expect, vi, beforeEach } from 'vitest';

// Keep the real pure scope helpers (isValidScopePair, DEFAULT_*); stub the
// DB-touching user functions so this pins the MCP wiring, not the DB.
vi.mock('../../../../services/user', async (importActual) => {
  const actual = await importActual<typeof import('../../../../services/user')>();
  return {
    ...actual,
    listUsers: vi.fn(),
    createUser: vi.fn(),
    addUserRole: vi.fn().mockResolvedValue({ role: 'r', type: 'member' }),
    removeUserRole: vi.fn(),
  };
});
vi.mock('../../../../services/role', () => ({
  listRoles: vi.fn(),
  createRole: vi.fn(),
  addEscalationChain: vi.fn(),
}));
vi.mock('../../../../lib/db', () => ({
  getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

import * as userService from '../../../../services/user';
import { registerUserTools } from '../../../../system/mcp-servers/admin/users';

const mockAddUserRole = vi.mocked(userService.addUserRole);
const mockCreateUser = vi.mocked(userService.createUser);

function captureTools() {
  const handlers = new Map<string, (args: any) => Promise<any>>();
  const server = {
    registerTool(name: string, _def: unknown, handler: (args: any) => Promise<any>) {
      handlers.set(name, handler);
    },
  };
  registerUserTools(server as any);
  return handlers;
}

let tools: Map<string, (args: any) => Promise<any>>;
beforeEach(() => {
  vi.clearAllMocks();
  mockAddUserRole.mockResolvedValue({ role: 'r', type: 'member' } as any);
  tools = captureTools();
});

describe('add_user_role MCP tool — scope', () => {
  it('forwards read_scope/write_scope to addUserRole', async () => {
    await tools.get('add_user_role')!({
      user_id: 'u1', role: 'customer-triage', type: 'member',
      read_scope: 'self', write_scope: 'self',
    });
    expect(mockAddUserRole).toHaveBeenCalledWith('u1', 'customer-triage', 'member', {
      read_scope: 'self', write_scope: 'self',
    });
  });

  it('rejects write_scope=all with read_scope=self (write ⊆ read) without touching the DB', async () => {
    const res = await tools.get('add_user_role')!({
      user_id: 'u1', role: 'reviewer', type: 'member',
      read_scope: 'self', write_scope: 'all',
    });
    expect(res.isError).toBe(true);
    expect(mockAddUserRole).not.toHaveBeenCalled();
  });
});

describe('create_user MCP tool — scope', () => {
  it('passes scoped role grants through to createUser', async () => {
    mockCreateUser.mockResolvedValue({ id: 'new', roles: [] } as any);
    await tools.get('create_user')!({
      external_id: 'new-user', roles: [
        { role: 'customer-triage', type: 'member', read_scope: 'self', write_scope: 'self' },
      ],
    });
    expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({
      roles: [{ role: 'customer-triage', type: 'member', read_scope: 'self', write_scope: 'self' }],
    }));
  });

  it('rejects an invalid scope pair in a role grant', async () => {
    const res = await tools.get('create_user')!({
      external_id: 'x', roles: [
        { role: 'reviewer', type: 'member', read_scope: 'self', write_scope: 'all' },
      ],
    });
    expect(res.isError).toBe(true);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
