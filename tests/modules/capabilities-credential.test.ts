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

import {
  CREDENTIAL_ISSUER_ROLE,
  capabilityAccess,
  mayIssueCredentials,
  resolveCapabilities,
} from '../../modules/capabilities';

const USER = '00000000-0000-4000-8000-0000000000c2';

function holdRoles(...roles: string[]): void {
  lookups.hasRole.mockImplementation(async (_id: string, role: string) => roles.includes(role));
}

const grant = (role: string, type: 'member' | 'admin' | 'superadmin' = 'member') =>
  ({ role, type, read_scope: 'all' as const, write_scope: 'all' as const });

beforeEach(() => {
  lookups.isSuperAdmin.mockReset().mockResolvedValue(false);
  lookups.hasRole.mockReset().mockResolvedValue(false);
});

describe('mayIssueCredentials', () => {
  it('denies a missing principal without a lookup', async () => {
    expect(await mayIssueCredentials(undefined)).toBe(false);
    expect(await mayIssueCredentials({ userId: '' })).toBe(false);
    expect(lookups.hasRole).not.toHaveBeenCalled();
  });

  it('admits a superadmin claim or database superadmin', async () => {
    expect(await mayIssueCredentials({ userId: USER, role: 'superadmin' })).toBe(true);
    lookups.isSuperAdmin.mockResolvedValue(true);
    expect(await mayIssueCredentials({ userId: USER, role: 'member' })).toBe(true);
  });

  it('never admits an admin claim or the engineer role alone', async () => {
    holdRoles('engineer');
    expect(await mayIssueCredentials({ userId: USER, role: 'admin' })).toBe(false);
  });

  it('admits holders of the credential-issuer role', async () => {
    holdRoles(CREDENTIAL_ISSUER_ROLE);
    expect(await mayIssueCredentials({ userId: USER, role: 'member' })).toBe(true);
    expect(lookups.hasRole).toHaveBeenCalledWith(USER, CREDENTIAL_ISSUER_ROLE);
  });

  it('reads OAuth memberships with no lookup', async () => {
    expect(await mayIssueCredentials({ userId: USER, grantRoles: [grant(CREDENTIAL_ISSUER_ROLE)] })).toBe(true);
    expect(await mayIssueCredentials({ userId: USER, grantRoles: [grant('ops', 'admin')] })).toBe(false);
    expect(lookups.hasRole).not.toHaveBeenCalled();
  });
});

describe('credentialIssuer in the resolved set', () => {
  it('agrees with mayIssueCredentials', async () => {
    for (const roles of [[], ['engineer'], [CREDENTIAL_ISSUER_ROLE]]) {
      holdRoles(...roles);
      const principal = { userId: USER, role: 'admin' };
      expect((await resolveCapabilities(principal)).credentialIssuer).toBe(await mayIssueCredentials(principal));
    }
  });

  it('is granted to every superadmin', async () => {
    expect((await resolveCapabilities({ userId: USER, role: 'superadmin' })).credentialIssuer).toBe(true);
    expect((await resolveCapabilities({ userId: USER, grantRoles: [grant('x', 'superadmin')] })).credentialIssuer).toBe(true);
  });

  it('answers through capabilityAccess', async () => {
    holdRoles(CREDENTIAL_ISSUER_ROLE);
    expect(await capabilityAccess({ userId: USER, role: 'member' })('credentialIssuer')).toBe(true);
  });
});
