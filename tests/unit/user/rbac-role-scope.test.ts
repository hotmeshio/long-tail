import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

// roles.ts is imported transitively by rbac.ts; stub its DB-touching exports.
vi.mock('../../../services/user/roles', () => ({
  getUserRoles: vi.fn(),
  hasRoleType: vi.fn(),
}));

import { getRoleScope, getRoleWriteScope } from '../../../services/user/rbac';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('getRoleScope', () => {
  it('returns null when the user is not a member of the role', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await getRoleScope('user-1', 'reviewer')).toBeNull();
  });

  it('returns a member’s stored read/write scope', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ type: 'member', read_scope: 'all', write_scope: 'self' }],
    });
    expect(await getRoleScope('user-2', 'reviewer')).toEqual({ read: 'all', write: 'self' });
  });

  it('forces admin to all/all regardless of stored columns', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ type: 'admin', read_scope: 'self', write_scope: 'none' }],
    });
    expect(await getRoleScope('user-3', 'reviewer')).toEqual({ read: 'all', write: 'all' });
  });

  it('queries by the (user, role) primary key', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await getRoleScope('user-4', 'customer-triage');
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['user-4', 'customer-triage']);
  });
});

describe('getRoleWriteScope', () => {
  it('maps a non-member to none', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await getRoleWriteScope('user-1', 'reviewer')).toBe('none');
  });

  it('returns the effective write scope for a member', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ type: 'member', read_scope: 'self', write_scope: 'self' }],
    });
    expect(await getRoleWriteScope('user-2', 'customer-triage')).toBe('self');
  });

  it('returns none for a read-only (write_none) member', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ type: 'member', read_scope: 'all', write_scope: 'none' }],
    });
    expect(await getRoleWriteScope('user-3', 'auditor')).toBe('none');
  });
});
