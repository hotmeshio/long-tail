import { describe, it, expect, vi, beforeEach } from 'vitest';

// Claim-time provisioning is a sync of MEMBERSHIP, never of scope: it must use
// the scope-safe grant so a restricted holder (e.g. a write:none station) is
// never rewritten by a claim that declares the same role.

vi.mock('../../services/user', () => ({
  hasGlobalEscalationAccess: vi.fn(),
  grantRoleIfAbsent: vi.fn(),
  addUserRole: vi.fn(),
  getUserRoles: vi.fn(),
  getRoleScope: vi.fn(),
}));
vi.mock('../../lib/db', () => ({
  getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));
vi.mock('../../lib/events/publish', () => ({
  publishEscalationEvent: vi.fn(),
}));

import * as userService from '../../services/user';
import { ensureRoleMembership } from '../../api/escalations/helpers';

const mockGlobal = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGrantIfAbsent = vi.mocked(userService.grantRoleIfAbsent);
const mockAddUserRole = vi.mocked(userService.addUserRole);

beforeEach(() => {
  vi.clearAllMocks();
  mockGlobal.mockResolvedValue(true);
  mockGrantIfAbsent.mockResolvedValue(null);
});

describe('ensureRoleMembership — scope-safe provisioning', () => {
  const provision = {
    roles: [{ role: 'finisher', type: 'member', read_scope: 'all', write_scope: 'self' }],
  } as any;

  it('uses the if-absent grant, never the scope-overwriting upsert', async () => {
    const result = await ensureRoleMembership('user-1', 'finisher', 'caller-1', provision);
    expect(result).toBe(true);
    expect(mockGrantIfAbsent).toHaveBeenCalledWith('user-1', 'finisher', 'member', {
      read_scope: 'all',
      write_scope: 'self',
    });
    expect(mockAddUserRole).not.toHaveBeenCalled();
  });

  it('does nothing without caller authority or a declared role', async () => {
    mockGlobal.mockResolvedValue(false);
    expect(await ensureRoleMembership('user-1', 'finisher', 'caller-1', provision)).toBe(false);

    mockGlobal.mockResolvedValue(true);
    expect(await ensureRoleMembership('user-1', 'undeclared-role', 'caller-1', provision)).toBe(false);
    expect(mockGrantIfAbsent).not.toHaveBeenCalled();
  });
});
