import { describe, it, expect, vi, beforeEach } from 'vitest';

// Characterization of the admin, builder and role-manager gates exactly as
// they behave today, including which role lookups each path makes.

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

import { requireAdmin, requireBuilder, requireRoleManager } from '../../modules/auth';
import type { RequestHandler } from '../../lib/http';

type Principal = 'none' | 'noRole' | 'memberClaim' | 'adminClaim' | 'superadminClaim' | 'dbSuperadmin' | 'engineer' | 'lookupThrows';
type Outcome = 'next' | string;

const USER = '00000000-0000-4000-8000-0000000000a1';

/** Request auth and role-lookup results for each principal. */
function arrange(principal: Principal): { auth: Record<string, unknown> | undefined } {
  lookups.isSuperAdmin.mockResolvedValue(principal === 'dbSuperadmin');
  lookups.hasRole.mockImplementation(async (_id: string, role: string) => principal === 'engineer' && role === 'engineer');
  if (principal === 'lookupThrows') {
    lookups.isSuperAdmin.mockRejectedValue(new Error('invalid input syntax for type uuid'));
  }
  switch (principal) {
    case 'none': return { auth: undefined };
    case 'noRole': return { auth: { userId: USER } };
    case 'adminClaim': return { auth: { userId: USER, role: 'admin' } };
    case 'superadminClaim': return { auth: { userId: USER, role: 'superadmin' } };
    default: return { auth: { userId: USER, role: 'member' } };
  }
}

async function run(gate: RequestHandler, principal: Principal): Promise<Outcome> {
  const { auth } = arrange(principal);
  let outcome: Outcome = 'no response';
  const req = { auth } as any;
  const res = {
    status(code: number) { this.code = code; return this; },
    json(body: { error: string }) { outcome = `${this.code} ${body.error}`; },
  } as any;
  await gate(req, res, () => { outcome = 'next'; });
  return outcome;
}

const ADMIN_DENY = '403 Forbidden: admin access required';
const BUILDER_DENY = '403 Forbidden: builder access required';
const ROLE_MANAGER_DENY = '403 Forbidden: role-management access required';

const MATRIX: Record<Principal, { admin: Outcome; builder: Outcome; roleManager: Outcome }> = {
  none:            { admin: '403 Forbidden', builder: '403 Forbidden', roleManager: '403 Forbidden' },
  noRole:          { admin: ADMIN_DENY,      builder: BUILDER_DENY,    roleManager: ROLE_MANAGER_DENY },
  memberClaim:     { admin: ADMIN_DENY,      builder: BUILDER_DENY,    roleManager: ROLE_MANAGER_DENY },
  adminClaim:      { admin: 'next',          builder: BUILDER_DENY,    roleManager: 'next' },
  superadminClaim: { admin: 'next',          builder: 'next',          roleManager: 'next' },
  dbSuperadmin:    { admin: 'next',          builder: 'next',          roleManager: 'next' },
  engineer:        { admin: ADMIN_DENY,      builder: 'next',          roleManager: 'next' },
  lookupThrows:    { admin: '403 Forbidden', builder: '403 Forbidden', roleManager: '403 Forbidden' },
};

const GATES = { admin: requireAdmin, builder: requireBuilder, roleManager: requireRoleManager } as const;

beforeEach(() => {
  lookups.isSuperAdmin.mockReset();
  lookups.hasRole.mockReset();
});

describe('admin, builder and role-manager gates (characterization)', () => {
  for (const [principal, expected] of Object.entries(MATRIX) as [Principal, (typeof MATRIX)[Principal]][]) {
    for (const gateName of Object.keys(GATES) as (keyof typeof GATES)[]) {
      it(`${gateName} gate, ${principal} principal → ${expected[gateName]}`, async () => {
        expect(await run(GATES[gateName], principal)).toBe(expected[gateName]);
      });
    }
  }
});

describe('role lookups each gate makes (characterization)', () => {
  it('a superadmin claim passes every gate without a lookup', async () => {
    for (const gate of Object.values(GATES)) await run(gate, 'superadminClaim');
    expect(lookups.isSuperAdmin).not.toHaveBeenCalled();
    expect(lookups.hasRole).not.toHaveBeenCalled();
  });

  it('an admin claim passes the admin and role-manager gates without a lookup', async () => {
    await run(requireAdmin, 'adminClaim');
    await run(requireRoleManager, 'adminClaim');
    expect(lookups.isSuperAdmin).not.toHaveBeenCalled();
    expect(lookups.hasRole).not.toHaveBeenCalled();
  });

  it('the builder gate checks superadmin, then the engineer role, for an admin claim', async () => {
    await run(requireBuilder, 'adminClaim');
    expect(lookups.isSuperAdmin).toHaveBeenCalledWith(USER);
    expect(lookups.hasRole).toHaveBeenCalledWith(USER, 'engineer');
  });

  it('the admin gate never consults the engineer role', async () => {
    await run(requireAdmin, 'engineer');
    expect(lookups.isSuperAdmin).toHaveBeenCalledTimes(1);
    expect(lookups.hasRole).not.toHaveBeenCalled();
  });

  it('a member claim costs one lookup at the admin gate and two at the builder and role-manager gates', async () => {
    await run(requireAdmin, 'memberClaim');
    expect(lookups.isSuperAdmin).toHaveBeenCalledTimes(1);
    lookups.isSuperAdmin.mockClear();
    await run(requireBuilder, 'memberClaim');
    await run(requireRoleManager, 'memberClaim');
    expect(lookups.isSuperAdmin).toHaveBeenCalledTimes(2);
    expect(lookups.hasRole).toHaveBeenCalledTimes(2);
  });
});
