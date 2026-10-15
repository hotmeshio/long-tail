import { describe, it, expect, vi, beforeEach } from 'vitest';

// Account writes follow the grant rule: a new account's roles must each be
// grantable, a role is removed under the rule for the role as held, and an
// account holding superadmin is a superadmin's to manage.
const lookups = vi.hoisted(() => ({
  superadmins: new Set<string>(),
  held: new Map<string, Array<{ role: string; type: string }>>(),
  builders: new Set<string>(),
}));
vi.mock('../../services/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/user')>()),
  isSuperAdmin: vi.fn(async (id: string) => lookups.superadmins.has(id)),
  getUserRoles: vi.fn(async (id: string) => lookups.held.get(id) ?? []),
}));
vi.mock('../../services/user/roles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/user/roles')>()),
  hasRole: vi.fn(async (id: string, role: string) =>
    (role === 'engineer' && lookups.builders.has(id)) || (lookups.held.get(id) ?? []).some((r) => r.role === role)),
}));

import { mayGrantRoles, mayManageAccount, mayRevokeRole } from '../../modules/capabilities';

const SUPER = '00000000-0000-4000-8000-00000000000a';
const BUILDER = '00000000-0000-4000-8000-00000000000b';
const ADMIN = '00000000-0000-4000-8000-00000000000c';
const TARGET = '00000000-0000-4000-8000-00000000000d';

beforeEach(() => {
  lookups.superadmins = new Set([SUPER]);
  lookups.builders = new Set([BUILDER]);
  lookups.held = new Map([[ADMIN, [{ role: 'fleet', type: 'admin' }]]]);
});

describe('mayGrantRoles', () => {
  it('a superadmin may create an account with any roles', async () => {
    expect(await mayGrantRoles(SUPER, [{ role: 'ops', type: 'superadmin' }])).toEqual({ allowed: true });
  });

  it('a builder may not create a superadmin', async () => {
    expect(await mayGrantRoles(BUILDER, [{ role: 'fleet', type: 'member' }, { role: 'ops', type: 'superadmin' }]))
      .toMatchObject({ allowed: false });
  });

  it('an admin may grant only roles it holds; no roles is always allowed', async () => {
    expect(await mayGrantRoles(ADMIN, [{ role: 'fleet', type: 'member' }])).toEqual({ allowed: true });
    expect(await mayGrantRoles(ADMIN, [{ role: 'payroll', type: 'member' }])).toMatchObject({ allowed: false });
    expect(await mayGrantRoles(ADMIN, undefined)).toEqual({ allowed: true });
  });
});

describe('mayManageAccount', () => {
  it('only a superadmin may manage an account holding superadmin', async () => {
    lookups.superadmins.add(TARGET);
    expect(await mayManageAccount(BUILDER, TARGET)).toMatchObject({ allowed: false });
    expect(await mayManageAccount(SUPER, TARGET)).toEqual({ allowed: true });
  });

  it('any other account is left to the route gate; a non-uuid id defers to the handler', async () => {
    expect(await mayManageAccount(BUILDER, TARGET)).toEqual({ allowed: true });
    expect(await mayManageAccount(BUILDER, 'not-a-uuid')).toEqual({ allowed: true });
  });
});

describe('mayRevokeRole', () => {
  it('an admin may remove a role it holds, not one it lacks', async () => {
    lookups.held.set(TARGET, [{ role: 'fleet', type: 'member' }, { role: 'payroll', type: 'member' }]);
    expect(await mayRevokeRole(ADMIN, TARGET, 'fleet')).toEqual({ allowed: true });
    expect(await mayRevokeRole(ADMIN, TARGET, 'payroll')).toMatchObject({ allowed: false });
  });

  it('a superadmin grant is removed only by a superadmin', async () => {
    lookups.held.set(TARGET, [{ role: 'ops', type: 'superadmin' }]);
    lookups.superadmins.add(TARGET);
    expect(await mayRevokeRole(BUILDER, TARGET, 'ops')).toMatchObject({ allowed: false });
    expect(await mayRevokeRole(SUPER, TARGET, 'ops')).toEqual({ allowed: true });
  });

  it('a role the account does not hold defers to the handler', async () => {
    expect(await mayRevokeRole(ADMIN, TARGET, 'ghost')).toEqual({ allowed: true });
  });
});
