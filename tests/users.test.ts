import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from './setup';
import { migrate } from '../services/db/migrate';
import * as userService from '../services/user';

const { Connection } = Durable;

describe('User service', () => {
  let userId: string;

  beforeAll(async () => {
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();
  }, 30_000);

  afterAll(async () => {
    await Durable.shutdown();
  }, 10_000);

  // ── Create ──────────────────────────────────────────────────────────────

  it('should create a user with no roles', async () => {
    const user = await userService.createUser({
      external_id: 'ext-rbac-1',
      email: 'alice@example.com',
      display_name: 'Alice',
    });
    userId = user.id;

    expect(user.id).toBeTruthy();
    expect(user.external_id).toBe('ext-rbac-1');
    expect(user.status).toBe('active');
    expect(user.roles).toEqual([]);
  });

  it('should create a user with RBAC roles', async () => {
    const user = await userService.createUser({
      external_id: 'ext-rbac-2',
      roles: [
        { role: 'content-reviewers', type: 'admin' },
        { role: 'ops-team', type: 'member' },
      ],
    });

    expect(user.roles).toHaveLength(2);
    const adminRole = user.roles.find(r => r.role === 'content-reviewers');
    expect(adminRole!.type).toBe('admin');
    const memberRole = user.roles.find(r => r.role === 'ops-team');
    expect(memberRole!.type).toBe('member');

    await userService.deleteUser(user.id);
  });

  it('should reject duplicate external_id', async () => {
    await expect(
      userService.createUser({ external_id: 'ext-rbac-1' }),
    ).rejects.toThrow();
  });

  // ── Read ────────────────────────────────────────────────────────────────

  it('should get a user by ID with roles', async () => {
    const user = await userService.getUser(userId);
    expect(user).toBeTruthy();
    expect(user!.external_id).toBe('ext-rbac-1');
    expect(Array.isArray(user!.roles)).toBe(true);
  });

  it('should return null for unknown ID', async () => {
    expect(await userService.getUser('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('should get a user by external_id', async () => {
    const user = await userService.getUserByExternalId('ext-rbac-1');
    expect(user).toBeTruthy();
    expect(user!.id).toBe(userId);
  });

  it('should return null for unknown external_id', async () => {
    expect(await userService.getUserByExternalId('nonexistent')).toBeNull();
  });

  // ── Update ──────────────────────────────────────────────────────────────

  it('should update user fields', async () => {
    const updated = await userService.updateUser(userId, {
      display_name: 'Alice Updated',
      status: 'inactive',
    });
    expect(updated!.display_name).toBe('Alice Updated');
    expect(updated!.status).toBe('inactive');
  });

  it('should return null when updating nonexistent user', async () => {
    const result = await userService.updateUser(
      '00000000-0000-0000-0000-000000000000',
      { display_name: 'Ghost' },
    );
    expect(result).toBeNull();
  });

  // ── Role CRUD ───────────────────────────────────────────────────────────

  it('should add a member role', async () => {
    const role = await userService.addUserRole(userId, 'content-reviewers', 'member');
    expect(role.role).toBe('content-reviewers');
    expect(role.type).toBe('member');
  });

  it('should add an admin role', async () => {
    const role = await userService.addUserRole(userId, 'ops-team', 'admin');
    expect(role.role).toBe('ops-team');
    expect(role.type).toBe('admin');
  });

  it('should add a superadmin role', async () => {
    const role = await userService.addUserRole(userId, 'platform', 'superadmin');
    expect(role.role).toBe('platform');
    expect(role.type).toBe('superadmin');
  });

  it('should upsert type on conflict (promote member to admin)', async () => {
    await userService.addUserRole(userId, 'content-reviewers', 'admin');
    const roles = await userService.getUserRoles(userId);
    const cr = roles.find(r => r.role === 'content-reviewers');
    expect(cr!.type).toBe('admin');
  });

  it('should list all roles for a user', async () => {
    const roles = await userService.getUserRoles(userId);
    expect(roles).toHaveLength(3);
    expect(roles.map(r => r.role).sort()).toEqual(['content-reviewers', 'ops-team', 'platform']);
  });

  it('should check hasRole by name', async () => {
    expect(await userService.hasRole(userId, 'ops-team')).toBe(true);
    expect(await userService.hasRole(userId, 'nonexistent')).toBe(false);
  });

  it('should check hasRoleType', async () => {
    expect(await userService.hasRoleType(userId, 'superadmin')).toBe(true);
    expect(await userService.hasRoleType(userId, 'admin')).toBe(true);
    expect(await userService.hasRoleType(userId, 'member')).toBe(false);
  });

  it('should remove a role', async () => {
    expect(await userService.removeUserRole(userId, 'platform')).toBe(true);
    expect(await userService.hasRoleType(userId, 'superadmin')).toBe(false);
  });

  it('should return false when removing nonexistent role', async () => {
    expect(await userService.removeUserRole(userId, 'nonexistent')).toBe(false);
  });

  // ── RBAC helpers ────────────────────────────────────────────────────────

  describe('RBAC authorization', () => {
    let superAdminId: string;
    let groupAdminId: string;
    let memberId: string;

    beforeAll(async () => {
      // superadmin — global access
      const sa = await userService.createUser({ external_id: 'sa-rbac' });
      superAdminId = sa.id;
      await userService.addUserRole(superAdminId, 'platform', 'superadmin');

      // group admin — admin of content-reviewers only
      const ga = await userService.createUser({ external_id: 'ga-rbac' });
      groupAdminId = ga.id;
      await userService.addUserRole(groupAdminId, 'content-reviewers', 'admin');
      await userService.addUserRole(groupAdminId, 'ops-team', 'member');

      // plain member
      const m = await userService.createUser({ external_id: 'm-rbac' });
      memberId = m.id;
      await userService.addUserRole(memberId, 'content-reviewers', 'member');
    });

    it('isSuperAdmin: true for superadmin, false for others', async () => {
      expect(await userService.isSuperAdmin(superAdminId)).toBe(true);
      expect(await userService.isSuperAdmin(groupAdminId)).toBe(false);
      expect(await userService.isSuperAdmin(memberId)).toBe(false);
    });

    it('isGroupAdmin: admin can manage their group', async () => {
      expect(await userService.isGroupAdmin(groupAdminId, 'content-reviewers')).toBe(true);
    });

    it('isGroupAdmin: admin cannot manage other groups', async () => {
      expect(await userService.isGroupAdmin(groupAdminId, 'ops-team')).toBe(false);
    });

    it('isGroupAdmin: superadmin can manage any group', async () => {
      expect(await userService.isGroupAdmin(superAdminId, 'content-reviewers')).toBe(true);
      expect(await userService.isGroupAdmin(superAdminId, 'ops-team')).toBe(true);
      expect(await userService.isGroupAdmin(superAdminId, 'any-group')).toBe(true);
    });

    it('isGroupAdmin: member cannot manage', async () => {
      expect(await userService.isGroupAdmin(memberId, 'content-reviewers')).toBe(false);
    });

    it('canManageRole: mirrors isGroupAdmin', async () => {
      expect(await userService.canManageRole(superAdminId, 'content-reviewers')).toBe(true);
      expect(await userService.canManageRole(groupAdminId, 'content-reviewers')).toBe(true);
      expect(await userService.canManageRole(groupAdminId, 'ops-team')).toBe(false);
      expect(await userService.canManageRole(memberId, 'content-reviewers')).toBe(false);
    });

    it('isValidRoleType: validates type strings', () => {
      expect(userService.isValidRoleType('superadmin')).toBe(true);
      expect(userService.isValidRoleType('admin')).toBe(true);
      expect(userService.isValidRoleType('member')).toBe(true);
      expect(userService.isValidRoleType('custom')).toBe(false);
      expect(userService.isValidRoleType('')).toBe(false);
    });

    afterAll(async () => {
      await userService.deleteUser(superAdminId);
      await userService.deleteUser(groupAdminId);
      await userService.deleteUser(memberId);
    });
  });

  // ── List filters ────────────────────────────────────────────────────────

  it('should filter users by role name', async () => {
    const result = await userService.listUsers({ role: 'content-reviewers' });
    expect(result.users.every(u => u.roles.some(r => r.role === 'content-reviewers'))).toBe(true);
  });

  it('should filter users by role type', async () => {
    const result = await userService.listUsers({ roleType: 'admin' });
    expect(result.users.every(u => u.roles.some(r => r.type === 'admin'))).toBe(true);
  });

  it('should filter users by status', async () => {
    const result = await userService.listUsers({ status: 'inactive' });
    expect(result.users.every(u => u.status === 'inactive')).toBe(true);
  });

  it('should respect limit and offset', async () => {
    const page = await userService.listUsers({ limit: 1, offset: 0 });
    expect(page.users.length).toBeLessThanOrEqual(1);
  });

  // ── Delete (cascade) ───────────────────────────────────────────────────

  it('should cascade delete roles when user is deleted', async () => {
    const roles = await userService.getUserRoles(userId);
    expect(roles.length).toBeGreaterThan(0);

    expect(await userService.deleteUser(userId)).toBe(true);
    expect(await userService.getUser(userId)).toBeNull();
    expect(await userService.getUserRoles(userId)).toHaveLength(0);
  });

  it('should return false when deleting nonexistent user', async () => {
    expect(await userService.deleteUser('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});
