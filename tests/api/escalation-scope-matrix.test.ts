import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Exhaustive RBAC scope matrix: every role type × read_scope × write_scope,
 * intersected with item ownership and global access, across the verbs the gates
 * govern — view (read), claim/resolve/cancel (write), release/escalate/create
 * (queue-manage) — plus the claim-for / metadata partition resolvers.
 *
 * Expectations are DERIVED from effectiveScope (the single source of truth), so
 * adding a profile here cannot silently go unverified.
 */

// Keep the real pure scope helpers; stub only the DB-touching user functions.
vi.mock('../../services/user', async (importActual) => {
  const actual = await importActual<typeof import('../../services/user')>();
  return {
    ...actual,
    hasGlobalEscalationAccess: vi.fn(),
    getRoleScope: vi.fn(),
    getUserRoles: vi.fn(),
  };
});
vi.mock('../../lib/db', () => ({
  getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

import * as userService from '../../services/user';
import { effectiveScope } from '../../services/user';
import {
  assertReadAccess,
  assertWriteAccess,
  assertQueueManageAccess,
  getEscalationWriteScope,
  getEscalationReadScope,
} from '../../api/escalations/helpers';
import type { LTReadScope, LTRoleType, LTWriteScope } from '../../types';

const mockGlobal = vi.mocked(userService.hasGlobalEscalationAccess);
const mockRoleScope = vi.mocked(userService.getRoleScope);
const mockGetUserRoles = vi.mocked(userService.getUserRoles);

const TYPES: LTRoleType[] = ['member', 'admin', 'superadmin'];
const READS: LTReadScope[] = ['self', 'all'];
const WRITES: LTWriteScope[] = ['none', 'self', 'all'];

// A (read, write) pair is storable only when write ⊆ read.
const validPair = (read: LTReadScope, write: LTWriteScope) => !(write === 'all' && read === 'self');

const ROLE = 'reviewer';
const ME = 'me';
const escFor = (assigned_to: string | null) => ({ role: ROLE, assigned_to });

beforeEach(() => {
  vi.clearAllMocks();
  mockGlobal.mockResolvedValue(false);
});

describe('effectiveScope — full type × read × write cross-product', () => {
  for (const type of TYPES) {
    for (const read of READS) {
      for (const write of WRITES) {
        if (type === 'member' && !validPair(read, write)) continue;
        const expected = type === 'member' ? { read, write } : { read: 'all', write: 'all' };
        it(`${type}/${read}/${write} → see ${expected.read}, act ${expected.write}`, () => {
          expect(effectiveScope(type, read, write)).toEqual(expected);
        });
      }
    }
  }
});

describe('gate matrix — non-global caller, every profile × ownership', () => {
  for (const type of TYPES) {
    for (const read of READS) {
      for (const write of WRITES) {
        if (type === 'member' && !validPair(read, write)) continue;
        const eff = effectiveScope(type, read, write);
        for (const own of [true, false]) {
          // Derived truth table:
          const canRead = eff.read === 'all' || own;                       // view single
          const canWrite = eff.write === 'all' || (eff.write === 'self' && own); // claim/resolve/cancel
          const canManage = eff.write === 'all';                            // release/escalate/create

          it(`${type}/${read}/${write} own=${own} → read:${canRead} write:${canWrite} manage:${canManage}`, async () => {
            mockRoleScope.mockResolvedValue(eff);
            const esc = escFor(own ? ME : 'someone-else');

            expect((await assertReadAccess(ME, esc)) === null).toBe(canRead);
            expect((await assertWriteAccess(ME, esc)) === null).toBe(canWrite);
            expect((await assertQueueManageAccess(ME, ROLE)) === null).toBe(canManage);
          });
        }
      }
    }
  }
});

describe('gate matrix — global caller (superadmin / admin·admin)', () => {
  it('allows view, write, and queue-manage regardless of ownership or stored scope', async () => {
    mockGlobal.mockResolvedValue(true);
    for (const assigned of [ME, 'someone-else', null]) {
      expect(await assertReadAccess(ME, escFor(assigned))).toBeNull();
      expect(await assertWriteAccess(ME, escFor(assigned))).toBeNull();
    }
    expect(await assertQueueManageAccess(ME, ROLE)).toBeNull();
    // Global short-circuits before any per-role lookup.
    expect(mockRoleScope).not.toHaveBeenCalled();
  });
});

describe('gate matrix — non-member of the role', () => {
  it('denies view, write, and queue-manage (no membership)', async () => {
    mockRoleScope.mockResolvedValue(null);
    expect((await assertReadAccess(ME, escFor(ME)))?.status).toBe(403);
    expect((await assertWriteAccess(ME, escFor(ME)))?.status).toBe(403);
    expect((await assertQueueManageAccess(ME, ROLE))?.status).toBe(403);
  });
});

// ── claim-for / metadata partition ───────────────────────────────────────────
// claim-by-metadata uses write_all roles only; resolve-by-metadata uses
// write_all + write_self; list/find uses read_all + read_self.

const role = (
  r: string,
  type: LTRoleType,
  read: LTReadScope,
  write: LTWriteScope,
) => ({ role: r, type, read_scope: read, write_scope: write, created_at: new Date() });

describe('write-scope partition (claim-for / resolve-by-metadata)', () => {
  it('routes write_all (incl. admin) to allRoles, write_self to selfRoles, excludes read-only', async () => {
    mockGetUserRoles.mockResolvedValue([
      role('r_wall', 'member', 'all', 'all'),
      role('r_wself', 'member', 'all', 'self'),
      role('r_sself', 'member', 'self', 'self'),
      role('r_anone', 'member', 'all', 'none'), // read-only auditor — no write
      role('r_snone', 'member', 'self', 'none'), // read-only own — no write
      role('r_admin', 'admin', 'self', 'none'),  // effective all/all → write_all
    ]);
    const ws = await getEscalationWriteScope(ME);
    expect(ws.global).toBe(false);
    expect([...ws.allRoles].sort()).toEqual(['r_admin', 'r_wall']);
    expect([...ws.selfRoles].sort()).toEqual(['r_sself', 'r_wself']);
  });

  it('global caller short-circuits to global=true with no role filter', async () => {
    mockGlobal.mockResolvedValue(true);
    const ws = await getEscalationWriteScope(ME);
    expect(ws).toEqual({ global: true, allRoles: [], selfRoles: [] });
    expect(mockGetUserRoles).not.toHaveBeenCalled();
  });
});

describe('read-scope partition (search / list / find)', () => {
  it('routes read_all (incl. admin) to allRoles, read_self to selfRoles', async () => {
    mockGetUserRoles.mockResolvedValue([
      role('r_rall', 'member', 'all', 'all'),
      role('r_rallnone', 'member', 'all', 'none'),
      role('r_rself', 'member', 'self', 'self'),
      role('r_rselfnone', 'member', 'self', 'none'),
      role('r_admin', 'admin', 'self', 'self'), // effective all/all → read_all
    ]);
    const rs = await getEscalationReadScope(ME);
    expect([...rs.allRoles].sort()).toEqual(['r_admin', 'r_rall', 'r_rallnone']);
    expect([...rs.selfRoles].sort()).toEqual(['r_rself', 'r_rselfnone']);
  });
});
