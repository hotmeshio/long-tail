import * as userService from '../services/user';
import type { LTApiResult } from '../types/sdk';
import type { LTRoleType } from '../types';

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

// Admin-required
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

// Admin-required
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

// Admin-required
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

// Admin-required
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

// Admin-required
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
