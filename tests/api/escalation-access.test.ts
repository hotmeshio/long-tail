import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/user', async () => {
  return {
    isSuperAdmin: vi.fn(),
    getUserRoles: vi.fn(),
    hasGlobalEscalationAccess: vi.fn(),
    hasRole: vi.fn(),
    isGroupAdmin: vi.fn(),
    canManageRole: vi.fn(),
    hasRoleType: vi.fn(),
  };
});

vi.mock('../../lib/db', () => ({
  getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

import * as userService from '../../services/user';
import { getVisibleRoles } from '../../api/escalations/helpers';

const mockGetUserRoles = vi.mocked(userService.getUserRoles);
const mockHasGlobalAccess = vi.mocked(userService.hasGlobalEscalationAccess);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getVisibleRoles', () => {
  it('returns undefined for users with global escalation access (superadmin, admin/admin)', async () => {
    mockHasGlobalAccess.mockResolvedValue(true);
    expect(await getVisibleRoles('user-1')).toBeUndefined();
    expect(mockGetUserRoles).not.toHaveBeenCalled();
  });

  it('returns role names for engineer/admin (scoped to engineer)', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'engineer', type: 'admin', created_at: new Date() },
    ]);
    expect(await getVisibleRoles('user-3')).toEqual(['engineer']);
  });

  it('returns role names for grinder/member (scoped to grinder)', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'grinder', type: 'member', created_at: new Date() },
    ]);
    expect(await getVisibleRoles('user-4')).toEqual(['grinder']);
  });

  it('returns multiple role names for user with several roles', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'grinder', type: 'member', created_at: new Date() },
      { role: 'finisher', type: 'admin', created_at: new Date() },
    ]);
    expect(await getVisibleRoles('user-5')).toEqual(['grinder', 'finisher']);
  });
});
