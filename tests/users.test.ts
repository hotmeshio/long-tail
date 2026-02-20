import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { MemFlow } from '@hotmeshio/hotmesh';

import { postgres_options } from './setup';
import { migrate } from '../services/db/migrate';
import * as userService from '../services/user';
import type { LTUserRecord } from '../types';

const { Connection } = MemFlow;

describe('User service', () => {
  let createdUserId: string;

  beforeAll(async () => {
    await Connection.connect({
      class: Postgres,
      options: postgres_options,
    });
    await migrate();
  }, 30_000);

  afterAll(async () => {
    await MemFlow.shutdown();
  }, 10_000);

  // ── Create ──────────────────────────────────────────────────────────────

  it('should create a user with required fields only', async () => {
    const user = await userService.createUser({
      external_id: 'ext-user-1',
      email: 'alice@example.com',
      display_name: 'Alice',
    });
    createdUserId = user.id;

    expect(user.id).toBeTruthy();
    expect(user.external_id).toBe('ext-user-1');
    expect(user.email).toBe('alice@example.com');
    expect(user.display_name).toBe('Alice');
    expect(user.status).toBe('active');
    expect(user.roles).toEqual([]);
  });

  it('should create a user with roles', async () => {
    const user = await userService.createUser({
      external_id: 'ext-user-2',
      email: 'bob@example.com',
      display_name: 'Bob',
      roles: [
        { role: 'admin', type: 'admin' },
        { role: 'reviewer', type: 'reviewer' },
      ],
    });

    expect(user.roles).toHaveLength(2);
    expect(user.roles.map(r => r.role).sort()).toEqual(['admin', 'reviewer']);
    expect(user.roles.find(r => r.role === 'admin')!.type).toBe('admin');

    // Cleanup
    await userService.deleteUser(user.id);
  });

  it('should create a user with metadata', async () => {
    const user = await userService.createUser({
      external_id: 'ext-user-meta',
      email: 'meta@example.com',
      metadata: { team: 'ops', level: 3 },
    });
    expect(user.metadata).toEqual({ team: 'ops', level: 3 });

    await userService.deleteUser(user.id);
  });

  it('should reject duplicate external_id', async () => {
    await expect(
      userService.createUser({ external_id: 'ext-user-1' }),
    ).rejects.toThrow();
  });

  // ── Read ────────────────────────────────────────────────────────────────

  it('should get a user by ID with roles array', async () => {
    const user = await userService.getUser(createdUserId);
    expect(user).toBeTruthy();
    expect(user!.external_id).toBe('ext-user-1');
    expect(Array.isArray(user!.roles)).toBe(true);
  });

  it('should return null for unknown ID', async () => {
    const user = await userService.getUser('00000000-0000-0000-0000-000000000000');
    expect(user).toBeNull();
  });

  it('should get a user by external_id', async () => {
    const user = await userService.getUserByExternalId('ext-user-1');
    expect(user).toBeTruthy();
    expect(user!.id).toBe(createdUserId);
    expect(Array.isArray(user!.roles)).toBe(true);
  });

  it('should return null for unknown external_id', async () => {
    const user = await userService.getUserByExternalId('nonexistent');
    expect(user).toBeNull();
  });

  // ── Update ──────────────────────────────────────────────────────────────

  it('should update user fields', async () => {
    const updated = await userService.updateUser(createdUserId, {
      display_name: 'Alice Updated',
      status: 'inactive',
    });
    expect(updated).toBeTruthy();
    expect(updated!.display_name).toBe('Alice Updated');
    expect(updated!.status).toBe('inactive');
    expect(Array.isArray(updated!.roles)).toBe(true);
  });

  it('should return null when updating nonexistent user', async () => {
    const result = await userService.updateUser(
      '00000000-0000-0000-0000-000000000000',
      { display_name: 'Ghost' },
    );
    expect(result).toBeNull();
  });

  // ── Role management ─────────────────────────────────────────────────────

  it('should add a role to a user', async () => {
    const role = await userService.addUserRole(createdUserId, 'content-reviewer', 'reviewer');
    expect(role.role).toBe('content-reviewer');
    expect(role.type).toBe('reviewer');
    expect(role.created_at).toBeTruthy();
  });

  it('should add multiple roles to a user', async () => {
    await userService.addUserRole(createdUserId, 'super-admin', 'admin');

    const roles = await userService.getUserRoles(createdUserId);
    expect(roles.length).toBe(2);
    expect(roles.map(r => r.role).sort()).toEqual(['content-reviewer', 'super-admin']);
  });

  it('should upsert role type on conflict', async () => {
    await userService.addUserRole(createdUserId, 'content-reviewer', 'senior-reviewer');

    const roles = await userService.getUserRoles(createdUserId);
    const cr = roles.find(r => r.role === 'content-reviewer');
    expect(cr!.type).toBe('senior-reviewer');
  });

  it('should check hasRole by name', async () => {
    expect(await userService.hasRole(createdUserId, 'super-admin')).toBe(true);
    expect(await userService.hasRole(createdUserId, 'nonexistent')).toBe(false);
  });

  it('should check hasRoleType', async () => {
    expect(await userService.hasRoleType(createdUserId, 'admin')).toBe(true);
    expect(await userService.hasRoleType(createdUserId, 'nonexistent')).toBe(false);
  });

  it('should check isUserAdmin', async () => {
    expect(await userService.isUserAdmin(createdUserId)).toBe(true);
  });

  it('should remove a role', async () => {
    const removed = await userService.removeUserRole(createdUserId, 'super-admin');
    expect(removed).toBe(true);

    expect(await userService.isUserAdmin(createdUserId)).toBe(false);
  });

  it('should return false when removing nonexistent role', async () => {
    const removed = await userService.removeUserRole(createdUserId, 'nonexistent');
    expect(removed).toBe(false);
  });

  // ── List ────────────────────────────────────────────────────────────────

  it('should list users with role filter', async () => {
    // Ensure createdUser has a known role
    await userService.addUserRole(createdUserId, 'admin', 'admin');

    const user2 = await userService.createUser({
      external_id: 'ext-list-user',
      roles: [{ role: 'editor', type: 'editor' }],
    });

    // Filter by role name
    const admins = await userService.listUsers({ role: 'admin' });
    expect(admins.users.every(u => u.roles.some(r => r.role === 'admin'))).toBe(true);

    // Filter by role type
    const adminTypes = await userService.listUsers({ roleType: 'admin' });
    expect(adminTypes.users.every(u => u.roles.some(r => r.type === 'admin'))).toBe(true);

    // Cleanup
    await userService.deleteUser(user2.id);
  });

  it('should list users with status filter', async () => {
    const inactive = await userService.listUsers({ status: 'inactive' });
    expect(inactive.users.every(u => u.status === 'inactive')).toBe(true);
  });

  it('should respect limit and offset', async () => {
    const page = await userService.listUsers({ limit: 1, offset: 0 });
    expect(page.users.length).toBeLessThanOrEqual(1);
  });

  // ── Delete (cascade) ───────────────────────────────────────────────────

  it('should cascade delete roles when user is deleted', async () => {
    const roles = await userService.getUserRoles(createdUserId);
    expect(roles.length).toBeGreaterThan(0);

    const deleted = await userService.deleteUser(createdUserId);
    expect(deleted).toBe(true);

    const gone = await userService.getUser(createdUserId);
    expect(gone).toBeNull();

    // Roles should also be gone (CASCADE)
    const orphanRoles = await userService.getUserRoles(createdUserId);
    expect(orphanRoles).toHaveLength(0);
  });

  it('should return false when deleting nonexistent user', async () => {
    const deleted = await userService.deleteUser('00000000-0000-0000-0000-000000000000');
    expect(deleted).toBe(false);
  });
});
