import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookups = vi.hoisted(() => ({
  isSuperAdmin: vi.fn(async (_userId: string) => false),
  hasRole: vi.fn(async (_userId: string, _role: string) => false),
}));

vi.mock('../../services/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/user')>()),
  isSuperAdmin: lookups.isSuperAdmin,
}));
vi.mock('../../services/user/roles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/user/roles')>()),
  hasRole: lookups.hasRole,
}));

import { mayAdminister, mayBuild, mayManageRoles, mayGrantRole } from '../../modules/capabilities';

const USER = '00000000-0000-4000-8000-0000000000c1';

function holdRoles(...roles: string[]): void {
  lookups.hasRole.mockImplementation(async (_id: string, role: string) => roles.includes(role));
}

beforeEach(() => {
  lookups.isSuperAdmin.mockReset().mockResolvedValue(false);
  lookups.hasRole.mockReset().mockResolvedValue(false);
});

describe('capability predicates', () => {
  it('deny a missing principal or user id without a lookup', async () => {
    for (const check of [mayAdminister, mayBuild, mayManageRoles]) {
      expect(await check(undefined)).toBe(false);
      expect(await check({ userId: '' })).toBe(false);
    }
    expect(lookups.isSuperAdmin).not.toHaveBeenCalled();
    expect(lookups.hasRole).not.toHaveBeenCalled();
  });

  it('mayAdminister trusts admin and superadmin claims', async () => {
    expect(await mayAdminister({ userId: USER, role: 'admin' })).toBe(true);
    expect(await mayAdminister({ userId: USER, role: 'superadmin' })).toBe(true);
    expect(lookups.isSuperAdmin).not.toHaveBeenCalled();
  });

  it('mayAdminister falls back to the database superadmin check', async () => {
    expect(await mayAdminister({ userId: USER, role: 'member' })).toBe(false);
    lookups.isSuperAdmin.mockResolvedValue(true);
    expect(await mayAdminister({ userId: USER, role: 'member' })).toBe(true);
  });

  it('mayBuild admits the engineer role but not an admin claim alone', async () => {
    expect(await mayBuild({ userId: USER, role: 'admin' })).toBe(false);
    holdRoles('engineer');
    expect(await mayBuild({ userId: USER, role: 'member' })).toBe(true);
    expect(lookups.hasRole).toHaveBeenCalledWith(USER, 'engineer');
  });

  it('mayManageRoles admits admin claims and engineers', async () => {
    expect(await mayManageRoles({ userId: USER, role: 'admin' })).toBe(true);
    expect(await mayManageRoles({ userId: USER, role: 'member' })).toBe(false);
    holdRoles('engineer');
    expect(await mayManageRoles({ userId: USER, role: 'member' })).toBe(true);
  });

  it('propagate lookup errors to the caller', async () => {
    lookups.isSuperAdmin.mockRejectedValue(new Error('lookup failed'));
    await expect(mayAdminister({ userId: USER })).rejects.toThrow('lookup failed');
    await expect(mayBuild({ userId: USER })).rejects.toThrow('lookup failed');
  });
});

describe('mayGrantRole', () => {
  it('lets a superadmin grant any role and type', async () => {
    lookups.isSuperAdmin.mockResolvedValue(true);
    expect(await mayGrantRole(USER, { role: 'anything', type: 'superadmin' })).toEqual({ allowed: true });
    expect(lookups.hasRole).not.toHaveBeenCalled();
  });

  it('never lets a non-superadmin grant the superadmin type', async () => {
    holdRoles('engineer', 'reviewer');
    const decision = await mayGrantRole(USER, { role: 'reviewer', type: 'superadmin' });
    expect(decision).toEqual({ allowed: false, error: 'Only superadmin can assign superadmin role type' });
  });

  it('lets an engineer grant roles they do not hold', async () => {
    holdRoles('engineer');
    expect(await mayGrantRole(USER, { role: 'reviewer', type: 'admin' })).toEqual({ allowed: true });
  });

  it('limits other admins to roles they hold', async () => {
    holdRoles('reviewer');
    expect(await mayGrantRole(USER, { role: 'reviewer', type: 'member' })).toEqual({ allowed: true });
    expect(await mayGrantRole(USER, { role: 'billing', type: 'member' })).toEqual({
      allowed: false,
      error: "You can only assign roles you hold. You do not have the 'billing' role.",
    });
  });
});
