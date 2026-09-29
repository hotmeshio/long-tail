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

import { mayAdminister, mayBuild, mayManageRoles, mayGrantRole, resolveCapabilities, capabilityAccess } from '../../modules/capabilities';

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

describe('resolveCapabilities', () => {
  const PRINCIPALS: Array<[string, { userId: string; role?: string }, () => void]> = [
    ['member', { userId: USER, role: 'member' }, () => {}],
    ['admin claim', { userId: USER, role: 'admin' }, () => {}],
    ['superadmin claim', { userId: USER, role: 'superadmin' }, () => {}],
    ['database superadmin', { userId: USER, role: 'member' }, () => lookups.isSuperAdmin.mockResolvedValue(true)],
    ['engineer', { userId: USER, role: 'member' }, () => holdRoles('engineer')],
    ['admin claim and engineer', { userId: USER, role: 'admin' }, () => holdRoles('engineer')],
  ];

  for (const [label, principal, arrange] of PRINCIPALS) {
    it(`agrees with the predicates for a ${label}`, async () => {
      arrange();
      const set = await resolveCapabilities(principal);
      expect(set.caller).toBe(true);
      expect(set.admin).toBe(await mayAdminister(principal));
      expect(set.builder).toBe(await mayBuild(principal));
      expect(set.roleManager).toBe(await mayManageRoles(principal));
    });
  }

  it('grants nothing without a user id', async () => {
    expect(Object.values(await resolveCapabilities(undefined)).some(Boolean)).toBe(false);
  });

  it('marks superadmin from the claim or the database only', async () => {
    expect((await resolveCapabilities({ userId: USER, role: 'admin' })).superadmin).toBe(false);
    expect((await resolveCapabilities({ userId: USER, role: 'superadmin' })).superadmin).toBe(true);
    lookups.isSuperAdmin.mockResolvedValue(true);
    expect((await resolveCapabilities({ userId: USER, role: 'member' })).superadmin).toBe(true);
  });

  it('costs no lookup for a superadmin claim and at most two otherwise', async () => {
    await resolveCapabilities({ userId: USER, role: 'superadmin' });
    expect(lookups.isSuperAdmin).not.toHaveBeenCalled();
    expect(lookups.hasRole).not.toHaveBeenCalled();
    await resolveCapabilities({ userId: USER, role: 'member' });
    expect(lookups.isSuperAdmin).toHaveBeenCalledTimes(1);
    expect(lookups.hasRole).toHaveBeenCalledTimes(1);
  });

  it('propagates lookup errors', async () => {
    lookups.isSuperAdmin.mockRejectedValue(new Error('lookup failed'));
    await expect(resolveCapabilities({ userId: USER })).rejects.toThrow('lookup failed');
  });
});

describe('capabilityAccess', () => {
  it('answers caller without a lookup', async () => {
    const access = capabilityAccess({ userId: USER, role: 'member' });
    expect(await access('caller')).toBe(true);
    expect(lookups.isSuperAdmin).not.toHaveBeenCalled();
    expect(lookups.hasRole).not.toHaveBeenCalled();
  });

  it('resolves the other gates once, on first need', async () => {
    holdRoles('engineer');
    const access = capabilityAccess({ userId: USER, role: 'member' });
    expect(await access('builder')).toBe(true);
    expect(await access('admin')).toBe(false);
    expect(await access('roleManager')).toBe(true);
    expect(lookups.isSuperAdmin).toHaveBeenCalledTimes(1);
    expect(lookups.hasRole).toHaveBeenCalledTimes(1);
  });

  it('denies every gate without a user id', async () => {
    const access = capabilityAccess(undefined);
    expect(await access('caller')).toBe(false);
    expect(await access('admin')).toBe(false);
  });
});
