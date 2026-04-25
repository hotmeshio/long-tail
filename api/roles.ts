import * as roleService from '../services/role';
import type { LTApiResult } from '../types/sdk';

export async function listRoles(): Promise<LTApiResult> {
  try {
    const roles = await roleService.listDistinctRoles();
    return { status: 200, data: { roles } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function listRolesWithDetails(): Promise<LTApiResult> {
  try {
    const roles = await roleService.listRolesWithDetails();
    return { status: 200, data: { roles } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// Admin-required
export async function createRole(input: {
  role: string;
}): Promise<LTApiResult> {
  try {
    if (!input.role || typeof input.role !== 'string' || !input.role.trim()) {
      return { status: 400, error: 'role is required' };
    }
    const trimmed = input.role.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]*$/.test(trimmed)) {
      return {
        status: 400,
        error: 'Role must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores',
      };
    }
    await roleService.createRole(trimmed);
    return { status: 201, data: { role: trimmed } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getEscalationChains(): Promise<LTApiResult> {
  try {
    const chains = await roleService.getAllEscalationChains();
    return { status: 200, data: { chains } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// Admin-required
export async function addEscalationChain(input: {
  source_role: string;
  target_role: string;
}): Promise<LTApiResult> {
  try {
    if (!input.source_role || !input.target_role) {
      return { status: 400, error: 'source_role and target_role are required' };
    }
    await roleService.addEscalationChain(input.source_role, input.target_role);
    return {
      status: 201,
      data: { source_role: input.source_role, target_role: input.target_role },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// Admin-required
export async function removeEscalationChain(input: {
  source_role: string;
  target_role: string;
}): Promise<LTApiResult> {
  try {
    if (!input.source_role || !input.target_role) {
      return { status: 400, error: 'source_role and target_role are required' };
    }
    const removed = await roleService.removeEscalationChain(
      input.source_role,
      input.target_role,
    );
    if (!removed) {
      return { status: 404, error: 'Chain entry not found' };
    }
    return { status: 200, data: { removed: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getEscalationTargets(input: {
  role: string;
}): Promise<LTApiResult> {
  try {
    const targets = await roleService.getEscalationTargets(input.role);
    return { status: 200, data: { targets } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// Admin-required
export async function replaceEscalationTargets(input: {
  role: string;
  targets: string[];
}): Promise<LTApiResult> {
  try {
    if (!Array.isArray(input.targets)) {
      return { status: 400, error: 'targets must be an array of strings' };
    }
    await roleService.replaceEscalationTargets(input.role, input.targets);
    return { status: 200, data: { role: input.role, targets: input.targets } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// Admin-required
export async function deleteRole(input: {
  role: string;
}): Promise<LTApiResult> {
  try {
    const result = await roleService.deleteRole(input.role);
    if (!result.deleted) {
      return { status: 409, error: result.error || 'Cannot delete role' };
    }
    return { status: 200, data: { deleted: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
