import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/role');
vi.mock('../../../services/user/crud');
vi.mock('../../../services/user/roles');
vi.mock('../../../lib/logger', () => ({
  loggerRegistry: { info: vi.fn(), warn: vi.fn() },
}));

import { createRole } from '../../../services/role';
import { getUserByExternalId, createUser } from '../../../services/user/crud';
import { addUserRole, getUserRoles } from '../../../services/user/roles';
import { seedAdmin } from '../../../services/user/seed-admin';

const mockCreateRole = vi.mocked(createRole);
const mockGetUserByExternalId = vi.mocked(getUserByExternalId);
const mockCreateUser = vi.mocked(createUser);
const mockAddUserRole = vi.mocked(addUserRole);
const mockGetUserRoles = vi.mocked(getUserRoles);

describe('seedAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates superadmin role and user when user does not exist', async () => {
    mockGetUserByExternalId.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ id: 'uuid-123' } as any);

    const id = await seedAdmin({ externalId: 'admin', password: 'pass123' });

    expect(mockCreateRole).toHaveBeenCalledWith('superadmin');
    expect(mockGetUserByExternalId).toHaveBeenCalledWith('admin');
    expect(mockCreateUser).toHaveBeenCalledWith({
      external_id: 'admin',
      email: undefined,
      display_name: 'admin',
      password: 'pass123',
      roles: [{ role: 'superadmin', type: 'superadmin' }],
    });
    expect(id).toBe('uuid-123');
  });

  it('skips creation when user already exists with superadmin role', async () => {
    mockGetUserByExternalId.mockResolvedValue({ id: 'existing-uuid' } as any);
    mockGetUserRoles.mockResolvedValue([
      { role: 'superadmin', type: 'superadmin', created_at: new Date() },
    ]);

    const id = await seedAdmin({ externalId: 'admin' });

    expect(id).toBe('existing-uuid');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockAddUserRole).not.toHaveBeenCalled();
  });

  it('grants superadmin role when user exists but lacks it', async () => {
    mockGetUserByExternalId.mockResolvedValue({ id: 'existing-uuid' } as any);
    mockGetUserRoles.mockResolvedValue([
      { role: 'reviewer', type: 'member', created_at: new Date() },
    ]);

    const id = await seedAdmin({ externalId: 'admin' });

    expect(id).toBe('existing-uuid');
    expect(mockAddUserRole).toHaveBeenCalledWith('existing-uuid', 'superadmin', 'superadmin');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('passes displayName and email when provided', async () => {
    mockGetUserByExternalId.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ id: 'uuid-456' } as any);

    await seedAdmin({
      externalId: 'sysadmin',
      displayName: 'System Admin',
      email: 'sys@example.com',
      password: 'secret',
    });

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        external_id: 'sysadmin',
        display_name: 'System Admin',
        email: 'sys@example.com',
        password: 'secret',
      }),
    );
  });

  it('defaults displayName to externalId when omitted', async () => {
    mockGetUserByExternalId.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ id: 'uuid-789' } as any);

    await seedAdmin({ externalId: 'mybot' });

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        external_id: 'mybot',
        display_name: 'mybot',
      }),
    );
  });

  it('tolerates createRole conflict error', async () => {
    mockCreateRole.mockRejectedValue(new Error('duplicate'));
    mockGetUserByExternalId.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ id: 'uuid-ok' } as any);

    const id = await seedAdmin({ externalId: 'admin', password: 'x' });

    expect(id).toBe('uuid-ok');
  });
});
