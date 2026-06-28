import { describe, it, expect, vi, beforeEach } from 'vitest';

// Keep the real pure scope helpers (effectiveScope etc.); only stub the
// DB-touching functions the read-scope partition depends on.
vi.mock('../../services/user', async (importActual) => {
  const actual = await importActual<typeof import('../../services/user')>();
  return {
    ...actual,
    getUserRoles: vi.fn(),
    hasGlobalEscalationAccess: vi.fn(),
  };
});

vi.mock('../../lib/db', () => ({
  getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

import * as userService from '../../services/user';
import { getEscalationReadScope, getEscalationWriteScope } from '../../api/escalations/helpers';

const mockGetUserRoles = vi.mocked(userService.getUserRoles);
const mockHasGlobalAccess = vi.mocked(userService.hasGlobalEscalationAccess);

const role = (
  r: string,
  type: 'member' | 'admin' | 'superadmin',
  read: 'self' | 'all' = 'all',
  write: 'none' | 'self' | 'all' = 'all',
) => ({ role: r, type, read_scope: read, write_scope: write, created_at: new Date() });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEscalationReadScope', () => {
  it('is global for users with global escalation access (superadmin, admin/admin)', async () => {
    mockHasGlobalAccess.mockResolvedValue(true);
    expect(await getEscalationReadScope('user-1')).toEqual({
      global: true,
      allRoles: [],
      selfRoles: [],
    });
    expect(mockGetUserRoles).not.toHaveBeenCalled();
  });

  it('puts read_all members in allRoles', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([role('grinder', 'member', 'all', 'all')]);
    expect(await getEscalationReadScope('user-2')).toEqual({
      global: false,
      allRoles: ['grinder'],
      selfRoles: [],
    });
  });

  it('puts read_self members in selfRoles', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([role('customer-triage', 'member', 'self', 'self')]);
    expect(await getEscalationReadScope('user-3')).toEqual({
      global: false,
      allRoles: [],
      selfRoles: ['customer-triage'],
    });
  });

  it('partitions a mixed-scope user (read_all + read_self)', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      role('reviewer', 'member', 'all', 'self'),       // chat app: read all
      role('customer-triage', 'member', 'self', 'self'),
    ]);
    expect(await getEscalationReadScope('user-4')).toEqual({
      global: false,
      allRoles: ['reviewer'],
      selfRoles: ['customer-triage'],
    });
  });

  it('treats a scoped admin/member as read_all (effectiveScope override)', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    // A non-global admin of a role always reads the whole queue, regardless of
    // any stored scope columns.
    mockGetUserRoles.mockResolvedValue([role('finisher', 'admin', 'self', 'none')]);
    expect(await getEscalationReadScope('user-5')).toEqual({
      global: false,
      allRoles: ['finisher'],
      selfRoles: [],
    });
  });
});

describe('getEscalationWriteScope', () => {
  it('is global for users with global escalation access', async () => {
    mockHasGlobalAccess.mockResolvedValue(true);
    expect(await getEscalationWriteScope('user-1')).toEqual({
      global: true,
      allRoles: [],
      selfRoles: [],
    });
    expect(mockGetUserRoles).not.toHaveBeenCalled();
  });

  it('partitions write_all and write_self roles; excludes read-only (write_none)', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      role('operator', 'member', 'all', 'all'),         // write_all
      role('customer-triage', 'member', 'self', 'self'), // write_self
      role('auditor', 'member', 'all', 'none'),          // read-only → no write
    ]);
    expect(await getEscalationWriteScope('user-2')).toEqual({
      global: false,
      allRoles: ['operator'],
      selfRoles: ['customer-triage'],
    });
  });

  // Regression (v0.4.20): a non-global user with no roles must yield empty arrays
  // (which the SQL filters to zero rows), NOT global access. The `global` flag —
  // not an empty/undefined array — is what distinguishes "no filter" from "no roles".
  it('returns empty (not global) for a non-global user with no roles', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([]);
    expect(await getEscalationWriteScope('no-role-user')).toEqual({
      global: false,
      allRoles: [],
      selfRoles: [],
    });
  });
});
