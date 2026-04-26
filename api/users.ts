import * as userService from '../services/user';
import type { LTApiResult } from '../types/sdk';
import type { LTRoleType } from '../types';

/**
 * List users with optional filters for role, role type, status, and pagination.
 *
 * @param input.role — filter by role name
 * @param input.roleType — filter by role type (superadmin, admin, member)
 * @param input.status — filter by user status
 * @param input.limit — maximum number of users to return
 * @param input.offset — number of users to skip for pagination
 * @returns `{ status: 200, data: User[] }` on success
 */
export async function listUsers(input: {
  role?: string;
  roleType?: LTRoleType;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<LTApiResult> {
  try {
    const result = await userService.listUsers(input as any);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Retrieve a single user by ID.
 *
 * @param input.id — the user's unique identifier
 * @returns `{ status: 200, data: User }` on success, or `{ status: 404 }` if not found
 */
export async function getUser(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const user = await userService.getUser(input.id);
    if (!user) {
      return { status: 404, error: 'User not found' };
    }
    return { status: 200, data: user };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Create a new user. Requires admin privileges.
 *
 * Validates that external_id is present and that any provided roles have valid
 * names and types. Returns 409 if a user with the same external_id already exists.
 *
 * @param input.external_id — external system identifier (required)
 * @param input.email — user's email address
 * @param input.display_name — user's display name
 * @param input.roles — initial role assignments, each with a role name and type (superadmin, admin, member)
 * @param input.metadata — arbitrary key-value metadata to attach to the user
 * @returns `{ status: 201, data: User }` on success, or `{ status: 409 }` on duplicate external_id
 */
export async function createUser(input: {
  external_id?: string;
  email?: string;
  display_name?: string;
  roles?: { role: string; type: string }[];
  metadata?: Record<string, any>;
}): Promise<LTApiResult> {
  try {
    if (!input.external_id) {
      return { status: 400, error: 'external_id is required' };
    }
    if (input.roles) {
      for (const r of input.roles) {
        if (!r.role || !r.type || !userService.isValidRoleType(r.type)) {
          return {
            status: 400,
            error: 'Each role must have a role name and type (superadmin, admin, member)',
          };
        }
      }
    }
    const user = await userService.createUser({
      external_id: input.external_id,
      email: input.email,
      display_name: input.display_name,
      roles: input.roles as any,
      metadata: input.metadata,
    });
    return { status: 201, data: user };
  } catch (err: any) {
    if (err.code === '23505') {
      return { status: 409, error: 'User with this external_id already exists' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Update an existing user's profile fields. Requires admin privileges.
 *
 * Only the provided fields are updated; omitted fields remain unchanged.
 *
 * @param input.id — the user's unique identifier (required)
 * @param input.email — new email address
 * @param input.display_name — new display name
 * @param input.status — new user status
 * @param input.metadata — replacement metadata object
 * @returns `{ status: 200, data: User }` on success, or `{ status: 404 }` if not found
 */
export async function updateUser(input: {
  id: string;
  email?: string;
  display_name?: string;
  status?: string;
  metadata?: Record<string, any>;
}): Promise<LTApiResult> {
  try {
    const { id, ...fields } = input;
    const user = await userService.updateUser(id, fields as any);
    if (!user) {
      return { status: 404, error: 'User not found' };
    }
    return { status: 200, data: user };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Delete a user by ID. Requires admin privileges.
 *
 * @param input.id — the user's unique identifier
 * @returns `{ status: 200, data: { deleted: true } }` on success, or `{ status: 404 }` if not found
 */
export async function deleteUser(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const deleted = await userService.deleteUser(input.id);
    if (!deleted) {
      return { status: 404, error: 'User not found' };
    }
    return { status: 200, data: { deleted: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Retrieve all roles assigned to a user.
 *
 * @param input.id — the user's unique identifier
 * @returns `{ status: 200, data: { roles: Role[] } }` on success
 */
export async function getUserRoles(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const roles = await userService.getUserRoles(input.id);
    return { status: 200, data: { roles } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Assign a role to a user. Requires admin privileges.
 *
 * Validates that both role and type are provided and that the type is one of
 * superadmin, admin, or member.
 *
 * @param input.id — the user's unique identifier
 * @param input.role — the role name to assign
 * @param input.type — the role type (superadmin, admin, or member)
 * @returns `{ status: 201, data: UserRole }` on success
 */
export async function addUserRole(input: {
  id: string;
  role: string;
  type: string;
}): Promise<LTApiResult> {
  try {
    if (!input.role || !input.type) {
      return { status: 400, error: 'role and type are required' };
    }
    if (!userService.isValidRoleType(input.type)) {
      return { status: 400, error: 'type must be superadmin, admin, or member' };
    }
    const result = await userService.addUserRole(input.id, input.role, input.type);
    return { status: 201, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Remove a role from a user. Requires admin privileges.
 *
 * @param input.id — the user's unique identifier
 * @param input.role — the role name to remove
 * @returns `{ status: 200, data: { removed: true } }` on success, or `{ status: 404 }` if role not found
 */
export async function removeUserRole(input: {
  id: string;
  role: string;
}): Promise<LTApiResult> {
  try {
    const removed = await userService.removeUserRole(input.id, input.role);
    if (!removed) {
      return { status: 404, error: 'Role not found' };
    }
    return { status: 200, data: { removed: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
