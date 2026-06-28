import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ssoProvision } from '../../../services/user/sso-provision';
import * as crud from '../../../services/user/crud';
import * as roles from '../../../services/user/roles';
import type { LTSSOConfig, SSOIdentity } from '../../../types/auth';

vi.mock('../../../services/user/crud');
vi.mock('../../../services/user/roles');
vi.mock('../../../lib/logger', () => ({
  loggerRegistry: { info: vi.fn(), warn: vi.fn() },
}));

const mockGetUserByExternalId = vi.mocked(crud.getUserByExternalId);
const mockCreateUser = vi.mocked(crud.createUser);
const mockGetUserRoles = vi.mocked(roles.getUserRoles);
const mockAddUserRole = vi.mocked(roles.addUserRole);

const ssoConfig: LTSSOConfig = { resolve: () => null, defaultRoleType: 'member' };
const identity: SSOIdentity = {
  externalId: 'race-user',
  displayName: 'Race User',
  roles: ['grinder'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ssoProvision — concurrent first-login race recovery', () => {
  it('adopts the winner row and syncs roles when createUser hits external_id 23505', async () => {
    // Check sees no user; a concurrent login wins the insert; our createUser loses.
    mockGetUserByExternalId
      .mockResolvedValueOnce(null) // initial existence check
      .mockResolvedValueOnce({ id: 'winner-uuid', external_id: 'race-user' } as any); // recovery refetch
    mockCreateUser.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
    mockGetUserRoles.mockResolvedValue([{ role: 'grinder', type: 'member', created_at: '' }]);

    const result = await ssoProvision(identity, ssoConfig);

    expect(result.created).toBe(false);
    expect(result.userId).toBe('winner-uuid');
    expect(result.roles).toEqual([{ role: 'grinder', type: 'member' }]);
  });

  it('adds only roles the winner is missing during recovery', async () => {
    mockGetUserByExternalId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'winner-uuid', external_id: 'race-user' } as any);
    mockCreateUser.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    // Winner currently has no roles → 'grinder' must be synced.
    mockGetUserRoles
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ role: 'grinder', type: 'member', created_at: '' }]);

    await ssoProvision(identity, ssoConfig);

    expect(mockAddUserRole).toHaveBeenCalledWith('winner-uuid', 'grinder', 'member');
  });

  it('rethrows non-23505 errors instead of masking them', async () => {
    mockGetUserByExternalId.mockResolvedValueOnce(null);
    mockCreateUser.mockRejectedValue(Object.assign(new Error('connection lost'), { code: '08006' }));

    await expect(ssoProvision(identity, ssoConfig)).rejects.toThrow('connection lost');
  });
});
