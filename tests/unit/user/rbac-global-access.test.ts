import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/user/roles', () => ({
  getUserRoles: vi.fn(),
  hasRoleType: vi.fn(),
}));

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

import { hasGlobalEscalationAccess, isSuperAdmin } from '../../../services/user/rbac';
import { getUserRoles, hasRoleType } from '../../../services/user/roles';

const mockHasRoleType = vi.mocked(hasRoleType);
const mockGetUserRoles = vi.mocked(getUserRoles);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hasGlobalEscalationAccess', () => {
  it('returns true for superadmin/superadmin', async () => {
    mockHasRoleType.mockResolvedValue(true);
    expect(await hasGlobalEscalationAccess('user-1')).toBe(true);
    // Should not query roles — isSuperAdmin short-circuits
    expect(mockGetUserRoles).not.toHaveBeenCalled();
  });

  it('returns true for admin/admin', async () => {
    mockHasRoleType.mockResolvedValue(false); // not superadmin
    mockGetUserRoles.mockResolvedValue([
      { role: 'admin', type: 'admin', created_at: new Date() },
    ]);
    expect(await hasGlobalEscalationAccess('user-2')).toBe(true);
  });

  it('returns false for engineer/admin (scoped, not global)', async () => {
    mockHasRoleType.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'engineer', type: 'admin', created_at: new Date() },
    ]);
    expect(await hasGlobalEscalationAccess('user-3')).toBe(false);
  });

  it('returns false for grinder/admin (scoped, not global)', async () => {
    mockHasRoleType.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'grinder', type: 'admin', created_at: new Date() },
    ]);
    expect(await hasGlobalEscalationAccess('user-4')).toBe(false);
  });

  it('returns false for grinder/member', async () => {
    mockHasRoleType.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'grinder', type: 'member', created_at: new Date() },
    ]);
    expect(await hasGlobalEscalationAccess('user-5')).toBe(false);
  });

  it('returns true when user has admin/admin among multiple roles', async () => {
    mockHasRoleType.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'grinder', type: 'member', created_at: new Date() },
      { role: 'admin', type: 'admin', created_at: new Date() },
    ]);
    expect(await hasGlobalEscalationAccess('user-6')).toBe(true);
  });

  it('returns false for admin/member (wrong type)', async () => {
    mockHasRoleType.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'admin', type: 'member', created_at: new Date() },
    ]);
    expect(await hasGlobalEscalationAccess('user-7')).toBe(false);
  });
});
