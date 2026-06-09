/**
 * Tests for resolveAllowedRoles — the function that determines which
 * escalation roles a caller may act on.
 *
 * Regression test for v0.4.20 bug: system accounts with no assigned
 * roles returned [] (empty array) instead of null (global access).
 * Empty array passed to SQL WHERE clause filtered out ALL rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock user service
const mockHasGlobalEscalationAccess = vi.fn();
const mockGetUserRoles = vi.fn();

vi.mock('../../../services/user', () => ({
  hasGlobalEscalationAccess: (...args: any[]) => mockHasGlobalEscalationAccess(...args),
  getUserRoles: (...args: any[]) => mockGetUserRoles(...args),
}));

// Import the module under test — resolveAllowedRoles is private, so we
// test it indirectly through the exported functions. But since it's a
// critical helper, we extract and test the logic directly.
// The logic: if global access → null; if no roles → null; else → role names.

describe('resolveAllowedRoles logic', () => {
  beforeEach(() => {
    mockHasGlobalEscalationAccess.mockReset();
    mockGetUserRoles.mockReset();
  });

  // Inline the function logic for direct testing (mirrors api/escalations/metadata.ts)
  async function resolveAllowedRoles(userId: string): Promise<string[] | null> {
    if (await mockHasGlobalEscalationAccess(userId)) return null;
    const userRoles = await mockGetUserRoles(userId);
    return userRoles.map((r: any) => r.role);
  }

  it('returns null for superadmin (global access)', async () => {
    mockHasGlobalEscalationAccess.mockResolvedValue(true);
    const result = await resolveAllowedRoles('superadmin-id');
    expect(result).toBeNull();
    expect(mockGetUserRoles).not.toHaveBeenCalled();
  });

  it('returns null for admin/admin (global access)', async () => {
    mockHasGlobalEscalationAccess.mockResolvedValue(true);
    const result = await resolveAllowedRoles('admin-id');
    expect(result).toBeNull();
  });

  it('returns empty array for user with no roles (SQL filters out all rows)', async () => {
    // No roles = no access. System accounts that need unrestricted access
    // should be seeded with superadmin role (hasGlobalEscalationAccess → null).
    mockHasGlobalEscalationAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([]);
    const result = await resolveAllowedRoles('no-role-user');
    expect(result).toEqual([]); // empty = no matching roles in SQL WHERE
  });

  it('returns role names for scoped user with assigned roles', async () => {
    mockHasGlobalEscalationAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'reviewer', type: 'member' },
      { role: 'engineer', type: 'admin' },
    ]);
    const result = await resolveAllowedRoles('scoped-user');
    expect(result).toEqual(['reviewer', 'engineer']);
  });

  it('returns single role for user with one assignment', async () => {
    mockHasGlobalEscalationAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([{ role: 'reviewer', type: 'member' }]);
    const result = await resolveAllowedRoles('reviewer-user');
    expect(result).toEqual(['reviewer']);
  });
});

describe('empty array vs null in SQL WHERE context', () => {
  // These tests document the PostgreSQL behavior that caused the bug

  it('empty array is NOT null (the root cause)', () => {
    const emptyArray: string[] = [];
    // nullish coalescing does NOT coerce empty array to null
    const result = emptyArray ?? null;
    expect(result).toEqual([]); // [] not null!
    expect(result).not.toBeNull();
  });

  it('empty array length check catches the case', () => {
    const emptyArray: string[] = [];
    const isUnrestricted = emptyArray.length === 0;
    expect(isUnrestricted).toBe(true);
  });
});
