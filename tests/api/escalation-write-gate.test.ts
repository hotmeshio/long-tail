import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/user', async (importActual) => {
  const actual = await importActual<typeof import('../../services/user')>();
  return {
    ...actual,
    hasGlobalEscalationAccess: vi.fn(),
    getRoleScope: vi.fn(),
  };
});

vi.mock('../../lib/db', () => ({
  getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
}));

import * as userService from '../../services/user';
import {
  assertReadAccess,
  assertWriteAccess,
  assertQueueManageAccess,
} from '../../api/escalations/helpers';

const mockGlobal = vi.mocked(userService.hasGlobalEscalationAccess);
const mockRoleScope = vi.mocked(userService.getRoleScope);

const esc = (assigned_to: string | null = null) => ({ role: 'customer-triage', assigned_to });

beforeEach(() => {
  vi.clearAllMocks();
  mockGlobal.mockResolvedValue(false);
});

describe('assertWriteAccess', () => {
  it('allows global access regardless of ownership', async () => {
    mockGlobal.mockResolvedValue(true);
    expect(await assertWriteAccess('admin', esc(null))).toBeNull();
    expect(mockRoleScope).not.toHaveBeenCalled();
  });

  it('allows write_all on any item in the role', async () => {
    mockRoleScope.mockResolvedValue({ read: 'all', write: 'all' });
    expect(await assertWriteAccess('u1', esc('someone-else'))).toBeNull();
  });

  it('allows write_self only on the user’s own item', async () => {
    mockRoleScope.mockResolvedValue({ read: 'all', write: 'self' });
    expect(await assertWriteAccess('u1', esc('u1'))).toBeNull();
  });

  it('denies write_self on another user’s item', async () => {
    mockRoleScope.mockResolvedValue({ read: 'self', write: 'self' });
    const denied = await assertWriteAccess('u1', esc('u2'));
    expect(denied?.status).toBe(403);
  });

  it('denies read-only (write_none) members', async () => {
    mockRoleScope.mockResolvedValue({ read: 'all', write: 'none' });
    expect((await assertWriteAccess('u1', esc('u1')))?.status).toBe(403);
  });

  it('denies non-members', async () => {
    mockRoleScope.mockResolvedValue(null);
    expect((await assertWriteAccess('u1', esc('u1')))?.status).toBe(403);
  });
});

describe('assertReadAccess', () => {
  it('allows global access', async () => {
    mockGlobal.mockResolvedValue(true);
    expect(await assertReadAccess('admin', esc(null))).toBeNull();
  });

  it('allows read_all on any item in the role', async () => {
    mockRoleScope.mockResolvedValue({ read: 'all', write: 'none' });
    expect(await assertReadAccess('u1', esc('u2'))).toBeNull();
  });

  it('allows read_self only on the user’s own item', async () => {
    mockRoleScope.mockResolvedValue({ read: 'self', write: 'self' });
    expect(await assertReadAccess('u1', esc('u1'))).toBeNull();
    expect((await assertReadAccess('u1', esc('u2')))?.status).toBe(403);
  });

  it('denies non-members', async () => {
    mockRoleScope.mockResolvedValue(null);
    expect((await assertReadAccess('u1', esc('u1')))?.status).toBe(403);
  });
});

describe('assertQueueManageAccess (release / escalate / create)', () => {
  it('allows global and write_all', async () => {
    mockGlobal.mockResolvedValue(true);
    expect(await assertQueueManageAccess('admin', 'customer-triage')).toBeNull();

    mockGlobal.mockResolvedValue(false);
    mockRoleScope.mockResolvedValue({ read: 'all', write: 'all' });
    expect(await assertQueueManageAccess('u1', 'customer-triage')).toBeNull();
  });

  it('denies write_self and read-only members (queue-management is not a self verb)', async () => {
    mockRoleScope.mockResolvedValue({ read: 'all', write: 'self' });
    expect((await assertQueueManageAccess('u1', 'customer-triage'))?.status).toBe(403);

    mockRoleScope.mockResolvedValue({ read: 'self', write: 'none' });
    expect((await assertQueueManageAccess('u1', 'customer-triage'))?.status).toBe(403);
  });
});
