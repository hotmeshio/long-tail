import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB pool
const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

// Mock dependencies that rbac.ts imports
vi.mock('../../../services/user/roles', () => ({
  hasRoleType: vi.fn().mockResolvedValue(false),
  getUserRoles: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../services/user/sql', () => ({
  IS_GROUP_ADMIN: 'SELECT 1',
}));

import { hasRolesAsAdmin } from '../../../services/user/rbac';

describe('hasRolesAsAdmin', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns true when user has admin type for all specified roles', async () => {
    mockQuery.mockResolvedValue({ rows: [{ cnt: 3 }] });
    const result = await hasRolesAsAdmin('user-1', ['reviewer', 'engineer', 'admin']);
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    // Verify it's a single batched query
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-1', ['reviewer', 'engineer', 'admin']]);
  });

  it('returns false when user lacks admin on some roles', async () => {
    mockQuery.mockResolvedValue({ rows: [{ cnt: 1 }] }); // has 1 of 3
    const result = await hasRolesAsAdmin('user-1', ['reviewer', 'engineer', 'admin']);
    expect(result).toBe(false);
  });

  it('returns false when user has admin on zero roles', async () => {
    mockQuery.mockResolvedValue({ rows: [{ cnt: 0 }] });
    const result = await hasRolesAsAdmin('user-1', ['reviewer']);
    expect(result).toBe(false);
  });

  it('returns true for empty roles array (vacuous truth)', async () => {
    const result = await hasRolesAsAdmin('user-1', []);
    expect(result).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled(); // no DB call needed
  });

  it('makes exactly one DB call regardless of role count', async () => {
    mockQuery.mockResolvedValue({ rows: [{ cnt: 5 }] });
    await hasRolesAsAdmin('user-1', ['a', 'b', 'c', 'd', 'e']);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
