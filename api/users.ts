import * as userService from '../services/user';
import type { LTApiResult } from '../types/sdk';
import type { LTReadScope, LTRoleType, LTWriteScope } from '../types';

/**
 * List users with optional filters for role, role type, status, and pagination.
 *
 * @param input.role — filter by role name
 * @param input.roleType — filter by role type (superadmin, admin, member)
 * @param input.status — filter by user status
 * @param input.search — free-text match on display name, email, or external_id
 * @param input.limit — maximum number of users to return
 * @param input.offset — number of users to skip for pagination
 * @returns `{ status: 200, data: User[] }` on success
 */
export async function listUsers(input: {
  role?: string;
  roleType?: LTRoleType;
  status?: string;
  search?: string;
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
 * Resolve many user ids to display fields (id, display_name, external_id, email)
 * in one call. Thin projection only — no secrets, scopes, or metadata. Non-UUID
 * ids are dropped, ids deduped, and the batch capped by the service.
 *
 * @param input.ids — the user ids to resolve
 * @returns `{ status: 200, data: { users: [{ id, display_name, external_id, email }] } }`
 */
export async function getUserNames(input: { ids?: string[] }): Promise<LTApiResult> {
  try {
    const ids = Array.isArray(input.ids) ? input.ids : [];
    const users = await userService.getUserNames(ids);
    return { status: 200, data: { users } };
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
  password?: string;
  roles?: { role: string; type: string; read_scope?: string; write_scope?: string }[];
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
        if (r.read_scope !== undefined && !userService.isValidReadScope(r.read_scope)) {
          return { status: 400, error: 'read_scope must be self or all' };
        }
        if (r.write_scope !== undefined && !userService.isValidWriteScope(r.write_scope)) {
          return { status: 400, error: 'write_scope must be none, self, or all' };
        }
        const read = (r.read_scope ?? userService.DEFAULT_READ_SCOPE) as LTReadScope;
        const write = (r.write_scope ?? userService.DEFAULT_WRITE_SCOPE) as LTWriteScope;
        if (!userService.isValidScopePair(read, write)) {
          return { status: 400, error: 'write_scope=all requires read_scope=all' };
        }
      }
    }
    const user = await userService.createUser({
      external_id: input.external_id,
      email: input.email,
      display_name: input.display_name,
      password: input.password,
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
 * @param input.metadata — REPLACES the whole properties dictionary; for
 *   per-key edits use patchUserProperties (never clobbers siblings)
 * @returns `{ status: 200, data: User }` on success, or `{ status: 404 }` if not found
 */
export async function updateUser(input: {
  id: string;
  email?: string;
  display_name?: string;
  password?: string;
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
 * Atomically patch the user's properties dictionary (lt_users.metadata) —
 * one statement, never read-merge-write. Deleting a key is explicit
 * (`remove`); a key absent from the patch is kept. `rename` preserves the
 * value with no key-absent window. Identity-binding keys (badge scan
 * scheme target facets) assert uniqueness among active users in the same
 * statement.
 *
 * @param input.id — the user's unique identifier
 * @param input.set — properties to set (typed JSON values)
 * @param input.remove — property keys to delete
 * @param input.rename — `{ oldKey: newKey }` renames, values preserved
 * @returns `{ status: 200, data: User }`; 400 malformed patch; 404 unknown
 *   user; 409 when an identity value already belongs to another active user
 */
export async function patchUserProperties(input: {
  id: string;
  set?: Record<string, unknown>;
  remove?: string[];
  rename?: Record<string, string>;
}): Promise<LTApiResult> {
  try {
    const user = await userService.patchUserProperties(input.id, {
      set: input.set,
      remove: input.remove,
      rename: input.rename,
    });
    if (!user) {
      return { status: 404, error: 'User not found' };
    }
    return { status: 200, data: user };
  } catch (err: any) {
    if (err.status === 400 || err.status === 409) {
      return { status: err.status, error: err.message };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * The property keys the platform itself resolves identities against — every
 * enabled identity scan scheme's target facet. The dashboard marks these as
 * system properties.
 *
 * @returns `{ status: 200, data: { keys: string[] } }`
 */
export async function getSystemPropertyKeys(): Promise<LTApiResult> {
  try {
    const keys = await userService.getIdentityPropertyKeys();
    return { status: 200, data: { keys } };
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
  read_scope?: string;
  write_scope?: string;
}): Promise<LTApiResult> {
  try {
    if (!input.role || !input.type) {
      return { status: 400, error: 'role and type are required' };
    }
    if (!userService.isValidRoleType(input.type)) {
      return { status: 400, error: 'type must be superadmin, admin, or member' };
    }
    // Work-surface scope (optional; defaults to all/all = full worker). Only
    // meaningful for `member`; admin/superadmin normalize to all/all.
    if (input.read_scope !== undefined && !userService.isValidReadScope(input.read_scope)) {
      return { status: 400, error: 'read_scope must be self or all' };
    }
    if (input.write_scope !== undefined && !userService.isValidWriteScope(input.write_scope)) {
      return { status: 400, error: 'write_scope must be none, self, or all' };
    }
    const read = (input.read_scope ?? userService.DEFAULT_READ_SCOPE) as LTReadScope;
    const write = (input.write_scope ?? userService.DEFAULT_WRITE_SCOPE) as LTWriteScope;
    if (!userService.isValidScopePair(read, write)) {
      return { status: 400, error: 'write_scope=all requires read_scope=all (cannot act on what you cannot see)' };
    }
    const result = await userService.addUserRole(input.id, input.role, input.type, {
      read_scope: read,
      write_scope: write,
    });
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
