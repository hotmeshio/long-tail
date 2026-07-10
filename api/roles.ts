import * as roleService from '../services/role';
import { FACET_KEY } from '../services/escalation/facet-sql';
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
 * Update role metadata. Fields omitted from input are left unchanged.
 * form_schema, metadata_schema, and parent_role can be set to null to clear them.
 */
export async function updateRole(input: {
  role: string;
  title?: string | null;
  description?: string | null;
  /** The escalation resolve FORM schema (the JIT UI). Fields may carry x-lt-bind. */
  form_schema?: Record<string, any> | null;
  metadata_schema?: Record<string, any> | null;
  properties?: Record<string, any> | null;
  ops_visible?: boolean;
  parent_role?: string | null;
  sla_minutes?: number | null;
  target_per_hour?: number | null;
  worker_count?: number | null;
  /** Max age (minutes) before a pending unclaimed item counts as priority on the Pace Board. Falls back to sla_minutes. */
  priority_threshold_minutes?: number | null;
  /** Escalation metadata key holding the age origin (ISO 8601 UTC timestamp). Falls back to created_at. */
  priority_facet?: string | null;
  /** Replace the upstream-input set (omitted = preserve; null or [] = clear). */
  upstream_roles?: string[] | null;
  /** Recorded on the schema snapshot when this update changes a schema field. */
  change_summary?: string;
}): Promise<LTApiResult> {
  try {
    if (!input.role) {
      return { status: 400, error: 'role is required' };
    }
    for (const field of ['sla_minutes', 'target_per_hour', 'worker_count', 'priority_threshold_minutes'] as const) {
      const value = input[field];
      if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        return { status: 400, error: `${field} must be a non-negative number or null` };
      }
    }
    if (input.worker_count != null && !Number.isInteger(input.worker_count)) {
      return { status: 400, error: 'worker_count must be a whole number' };
    }
    if (input.priority_facet != null && (typeof input.priority_facet !== 'string' || !FACET_KEY.test(input.priority_facet))) {
      return { status: 400, error: 'priority_facet must be a metadata key (letters, numbers, underscores) or null' };
    }
    if (input.ops_visible !== undefined && typeof input.ops_visible !== 'boolean') {
      return { status: 400, error: 'ops_visible must be a boolean' };
    }
    if (input.parent_role != null && input.parent_role === input.role) {
      return { status: 400, error: 'parent_role must reference a different role' };
    }
    if (input.upstream_roles != null) {
      if (!Array.isArray(input.upstream_roles) || input.upstream_roles.some((u) => typeof u !== 'string' || !u.trim())) {
        return { status: 400, error: 'upstream_roles must be an array of role names' };
      }
      if (input.upstream_roles.includes(input.role)) {
        return { status: 400, error: 'upstream_roles must not include the role itself' };
      }
      const known = new Set(await roleService.listDistinctRoles());
      const unknown = input.upstream_roles.filter((u) => !known.has(u));
      if (unknown.length > 0) {
        return { status: 400, error: `upstream_roles reference unknown role(s): ${unknown.join(', ')}` };
      }
    }
    const updated = await roleService.updateRoleMetadata(input.role, {
      title: input.title,
      description: input.description,
      form_schema: input.form_schema,
      metadata_schema: input.metadata_schema,
      properties: input.properties,
      ops_visible: input.ops_visible,
      parent_role: input.parent_role,
      sla_minutes: input.sla_minutes,
      target_per_hour: input.target_per_hour,
      worker_count: input.worker_count,
      priority_threshold_minutes: input.priority_threshold_minutes,
      priority_facet: input.priority_facet,
      upstream_roles: input.upstream_roles,
      change_summary: input.change_summary,
    });
    if (!updated) {
      return { status: 404, error: `Role '${input.role}' not found` };
    }
    return { status: 200, data: updated };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Fetch a role's schema pair (form_schema + metadata_schema).
 *
 * With `version`, returns that immutable snapshot from the version history —
 * a missing version is a 404, never a silent fall-through to latest. Without
 * `version`, returns the live (latest) schema along with the current version
 * number so callers can tell what they got.
 *
 * @param input.role — the role whose schema to fetch
 * @param input.version — optional version pin (positive integer)
 * @returns `{ status: 200, data: RoleSchemaVersion }` on success
 */
export async function getRoleSchema(input: {
  role: string;
  version?: number;
}): Promise<LTApiResult> {
  try {
    if (!input.role) {
      return { status: 400, error: 'role is required' };
    }
    if (input.version !== undefined && (!Number.isInteger(input.version) || input.version < 1)) {
      return { status: 400, error: 'version must be a positive integer' };
    }
    const schema = await roleService.getRoleSchema(input.role, input.version);
    if (!schema) {
      return {
        status: 404,
        error: input.version !== undefined
          ? `Schema version ${input.version} not found for role '${input.role}'`
          : `Role '${input.role}' not found`,
      };
    }
    return { status: 200, data: schema };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * List a role's schema version history, newest first. Each entry carries the
 * version number, presence flags for the two schemas, the change summary, and
 * whether it is the role's current version. Full snapshots come from
 * `getRoleSchema({ role, version })`.
 *
 * @param input.role — the role whose history to list
 * @returns `{ status: 200, data: { versions: RoleSchemaVersionSummary[] } }` on success
 */
export async function listRoleSchemaVersions(input: {
  role: string;
}): Promise<LTApiResult> {
  try {
    if (!input.role) {
      return { status: 400, error: 'role is required' };
    }
    const versions = await roleService.listRoleSchemaVersions(input.role);
    return { status: 200, data: { versions } };
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
