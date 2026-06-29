import * as roleService from '../services/role';
import { isRoleHomeView, ROLE_HOME_VIEWS } from '../services/role';
import type { RoleHomeView } from '../services/role';
import type { LTApiResult } from '../types/sdk';

/**
 * List all distinct role names in the system.
 *
 * @returns `{ status: 200, data: { roles: string[] } }` on success
 */
export async function listRoles(): Promise<LTApiResult> {
  try {
    const roles = await roleService.listDistinctRoles();
    return { status: 200, data: { roles } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * List all roles with their full details (member counts, escalation chains, etc.).
 *
 * @returns `{ status: 200, data: { roles: RoleDetail[] } }` on success
 */
export async function listRolesWithDetails(): Promise<LTApiResult> {
  try {
    const roles = await roleService.listRolesWithDetails();
    return { status: 200, data: { roles } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Create a new role. Requires admin privileges.
 *
 * The role name is trimmed, lowercased, and validated against the pattern
 * `^[a-z][a-z0-9_-]*$` (must start with a letter, then lowercase alphanumerics,
 * hyphens, or underscores).
 *
 * @param input.role — the role name to create
 * @returns `{ status: 201, data: { role: string } }` on success
 */
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

/**
 * Get a role's self-describing config (title / purpose / metadata schema / home_view).
 *
 * @param input.role — the role to read
 * @returns `{ status: 200, data: { config } }`, or 404 if the role is unknown
 */
export async function getRoleConfig(input: { role: string }): Promise<LTApiResult> {
  try {
    const config = await roleService.getRoleConfig(input.role);
    if (!config) return { status: 404, error: `Role not found: ${input.role}` };
    return { status: 200, data: { config } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Patch a role's config. Requires admin privileges. Only provided fields change.
 * An invalid `metadata_schema` or `home_view` is rejected with 400.
 *
 * @returns `{ status: 200, data: { config } }` with the updated config
 */
export async function updateRoleConfig(input: {
  role: string;
  title?: string | null;
  purpose?: string | null;
  metadata_schema?: Record<string, any> | null;
  home_view?: RoleHomeView | null;
}): Promise<LTApiResult> {
  try {
    if (input.home_view != null && !isRoleHomeView(input.home_view)) {
      return {
        status: 400,
        error: `home_view must be one of: ${Object.values(ROLE_HOME_VIEWS).join(', ')}`,
      };
    }
    await roleService.updateRoleConfig(input.role, {
      title: input.title,
      purpose: input.purpose,
      metadataSchema: input.metadata_schema,
      homeView: input.home_view,
    });
    const config = await roleService.getRoleConfig(input.role);
    return { status: 200, data: { config } };
  } catch (err: any) {
    // The service throws on an uncompilable metadata schema — a client error.
    if (typeof err.message === 'string' && err.message.startsWith('Invalid metadata_schema')) {
      return { status: 400, error: err.message };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * List a role's dials (goal rate / crew per station).
 *
 * @returns `{ status: 200, data: { dials: RoleDial[] } }`
 */
export async function getRoleDials(input: { role: string }): Promise<LTApiResult> {
  try {
    const dials = await roleService.getRoleDials(input.role);
    return { status: 200, data: { dials } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Upsert one station's per-unit TAT target. Requires admin privileges.
 *
 * @returns `{ status: 200, data: { role, station, target_tat_seconds } }`
 */
export async function upsertRoleDial(input: {
  role: string;
  station: string;
  target_tat_seconds: number;
}): Promise<LTApiResult> {
  try {
    if (!input.station || typeof input.station !== 'string' || !input.station.trim()) {
      return { status: 400, error: 'station is required' };
    }
    if (
      typeof input.target_tat_seconds !== 'number' ||
      !Number.isFinite(input.target_tat_seconds) ||
      input.target_tat_seconds <= 0
    ) {
      return { status: 400, error: 'target_tat_seconds must be a positive number (seconds per unit)' };
    }
    await roleService.upsertRoleDial(input.role, input.station, {
      targetTatSeconds: input.target_tat_seconds,
    });
    return {
      status: 200,
      data: { role: input.role, station: input.station, target_tat_seconds: input.target_tat_seconds },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Remove one station's dial from a role. Requires admin privileges.
 *
 * @returns `{ status: 200, data: { removed: true } }`, or 404 if absent
 */
export async function deleteRoleDial(input: {
  role: string;
  station: string;
}): Promise<LTApiResult> {
  try {
    const removed = await roleService.deleteRoleDial(input.role, input.station);
    if (!removed) return { status: 404, error: 'Dial not found' };
    return { status: 200, data: { removed: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Retrieve all escalation chains across all roles.
 *
 * @returns `{ status: 200, data: { chains: EscalationChain[] } }` on success
 */
export async function getEscalationChains(): Promise<LTApiResult> {
  try {
    const chains = await roleService.getAllEscalationChains();
    return { status: 200, data: { chains } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Add an escalation chain link from one role to another. Requires admin privileges.
 *
 * @param input.source_role — the role that escalates from
 * @param input.target_role — the role that receives the escalation
 * @returns `{ status: 201, data: { source_role, target_role } }` on success
 */
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

/**
 * Remove an escalation chain link between two roles. Requires admin privileges.
 *
 * @param input.source_role — the role that escalates from
 * @param input.target_role — the role that receives the escalation
 * @returns `{ status: 200, data: { removed: true } }` on success, or `{ status: 404 }` if not found
 */
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

/**
 * Get all escalation target roles for a given source role.
 *
 * @param input.role — the source role to look up escalation targets for
 * @returns `{ status: 200, data: { targets: string[] } }` on success
 */
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

/**
 * Replace all escalation targets for a role with a new set. Requires admin privileges.
 *
 * Removes all existing escalation links from the source role and creates new
 * ones for each target in the provided array.
 *
 * @param input.role — the source role whose targets are being replaced
 * @param input.targets — array of target role names to set as the new escalation targets
 * @returns `{ status: 200, data: { role, targets } }` on success
 */
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

/**
 * Delete a role from the system. Requires admin privileges.
 *
 * Returns 409 if the role cannot be deleted (e.g., still assigned to users).
 *
 * @param input.role — the role name to delete
 * @returns `{ status: 200, data: { deleted: true } }` on success, or `{ status: 409 }` if deletion blocked
 */
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
