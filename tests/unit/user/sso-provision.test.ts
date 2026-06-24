import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ssoProvision } from '../../../services/user/sso-provision';
import * as crud from '../../../services/user/crud';
import * as roles from '../../../services/user/roles';
import type { LTSSOConfig, SSOIdentity } from '../../../types/auth';

vi.mock('../../../services/user/crud');
vi.mock('../../../services/user/roles');
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

const mockGetUserByExternalId = vi.mocked(crud.getUserByExternalId);
const mockCreateUser = vi.mocked(crud.createUser);
const mockGetUserRoles = vi.mocked(roles.getUserRoles);
const mockAddUserRole = vi.mocked(roles.addUserRole);

const baseSSOConfig: LTSSOConfig = {
  resolve: () => null,
  defaultRoleType: 'member',
};

const identity: SSOIdentity = {
  externalId: 'sso-user-uuid-123',
  displayName: 'Jane Doe',
  email: 'jane@example.com',
  roles: ['grinder', 'quality-inspector'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ssoProvision', () => {
  it('creates a new user when external_id does not exist', async () => {
    mockGetUserByExternalId.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({
      id: 'lt-uuid-1',
      external_id: 'sso-user-uuid-123',
      display_name: 'Jane Doe',
      email: 'jane@example.com',
      status: 'active',
      account_type: 'user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      roles: [
        { role: 'grinder', type: 'member', created_at: '' },
        { role: 'quality-inspector', type: 'member', created_at: '' },
      ],
    });

    const result = await ssoProvision(identity, baseSSOConfig);

    expect(result.created).toBe(true);
    expect(result.userId).toBe('lt-uuid-1');
    expect(result.roles).toHaveLength(2);
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        external_id: 'sso-user-uuid-123',
        display_name: 'Jane Doe',
        email: 'jane@example.com',
      }),
    );
  });

  it('returns existing user when external_id already exists', async () => {
    mockGetUserByExternalId.mockResolvedValue({
      id: 'lt-uuid-1',
      external_id: 'sso-user-uuid-123',
      display_name: 'Jane Doe',
      email: 'jane@example.com',
      status: 'active',
      account_type: 'user',
      created_at: '',
      updated_at: '',
      roles: [],
    });
    mockGetUserRoles.mockResolvedValue([
      { role: 'grinder', type: 'member', created_at: '' },
    ]);

    const result = await ssoProvision(identity, baseSSOConfig);

    expect(result.created).toBe(false);
    expect(result.userId).toBe('lt-uuid-1');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('syncs new roles on existing user', async () => {
    mockGetUserByExternalId.mockResolvedValue({
      id: 'lt-uuid-1',
      external_id: 'sso-user-uuid-123',
      display_name: 'Jane Doe',
      email: 'jane@example.com',
      status: 'active',
      account_type: 'user',
      created_at: '',
      updated_at: '',
      roles: [],
    });
    // First call: current roles (only grinder)
    mockGetUserRoles
      .mockResolvedValueOnce([{ role: 'grinder', type: 'member', created_at: '' }])
      // Second call: after sync
      .mockResolvedValueOnce([
        { role: 'grinder', type: 'member', created_at: '' },
        { role: 'quality-inspector', type: 'member', created_at: '' },
      ]);

    const result = await ssoProvision(identity, baseSSOConfig);

    // quality-inspector was missing, should have been added
    expect(mockAddUserRole).toHaveBeenCalledWith('lt-uuid-1', 'quality-inspector', 'member');
    // grinder already existed, should NOT be re-added
    expect(mockAddUserRole).not.toHaveBeenCalledWith('lt-uuid-1', 'grinder', 'member');
    expect(result.roles).toHaveLength(2);
  });

  it('applies roleMap when configured', async () => {
    mockGetUserByExternalId.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({
      id: 'lt-uuid-1',
      external_id: 'sso-user-uuid-123',
      display_name: 'Jane Doe',
      email: 'jane@example.com',
      status: 'active',
      account_type: 'user',
      created_at: '',
      updated_at: '',
      roles: [{ role: 'superadmin', type: 'superadmin', created_at: '' }],
    });

    const configWithMap: LTSSOConfig = {
      ...baseSSOConfig,
      roleMap: { admin: 'superadmin', 'quality-inspector': 'qc-reviewer' },
    };
    const adminIdentity: SSOIdentity = {
      externalId: 'sso-admin-uuid',
      roles: ['admin', 'quality-inspector', 'unknown-role'],
    };

    await ssoProvision(adminIdentity, configWithMap);

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: expect.arrayContaining([
          { role: 'superadmin', type: 'superadmin' },
          { role: 'qc-reviewer', type: 'member' },
        ]),
      }),
    );
    // unknown-role should be filtered out (not in roleMap)
    const callRoles = mockCreateUser.mock.calls[0][0].roles;
    expect(callRoles).toHaveLength(2);
  });

  it('assigns default role when identity has no roles', async () => {
    mockGetUserByExternalId.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({
      id: 'lt-uuid-1',
      external_id: 'no-roles-user',
      display_name: 'No Roles',
      status: 'active',
      account_type: 'user',
      created_at: '',
      updated_at: '',
      roles: [{ role: 'member', type: 'member', created_at: '' }],
    });

    const noRolesIdentity: SSOIdentity = { externalId: 'no-roles-user' };

    await ssoProvision(noRolesIdentity, baseSSOConfig);

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        roles: [{ role: 'member', type: 'member' }],
      }),
    );
  });
});
