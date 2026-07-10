import { getPool } from '../../lib/db';
import { hasGlobalEscalationAccess, hasRole } from '../user';
import {
  GET_ESCALATION_TARGETS,
  GET_ALL_ESCALATION_CHAINS,
  INSERT_ESCALATION_CHAIN,
  ADD_ESCALATION_CHAIN,
  DELETE_ESCALATION_CHAIN,
  DELETE_ESCALATION_CHAINS_BY_SOURCE,
  CHECK_ESCALATION_CHAIN_EXISTS,
  ENSURE_ROLE_EXISTS,
  LIST_ROLES,
  DELETE_ROLE,
  LIST_ROLES_WITH_DETAILS,
  UPDATE_ROLE_METADATA,
  GET_ROLE_FORM_SCHEMA,
  GET_ROLE_METADATA_SCHEMA,
  GET_ROLE_UPSTREAMS,
  LIST_ROLE_SCHEMA_VERSIONS,
  GET_ROLE_SCHEMA_VERSION,
  GET_ROLE_SCHEMA_CURRENT,
  COUNT_USER_ROLE_REFS,
  COUNT_CHAIN_REFS,
  COUNT_WORKFLOW_REFS,
  COUNT_ACTIVE_ESCALATION_REFS,
} from './sql';

import type {
  EscalationChain,
  RoleDetail,
  RoleSchemaVersion,
  RoleSchemaVersionSummary,
  UpdateRoleInput,
} from './types';

/**
 * Get the roles a given source role can escalate to.
 */
export async function getEscalationTargets(sourceRole: string): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ESCALATION_TARGETS, [sourceRole]);
  return rows.map((r: any) => r.target_role);
}

/**
 * Get all escalation chain pairs.
 */
export async function getAllEscalationChains(): Promise<EscalationChain[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ALL_ESCALATION_CHAINS);
  return rows;
}

/**
 * Add a single escalation chain entry.
 */
export async function addEscalationChain(
  sourceRole: string,
  targetRole: string,
): Promise<void> {
  const pool = getPool();
  // One atomic statement: ensure both role FK targets + insert the chain link.
  await pool.query(ADD_ESCALATION_CHAIN, [sourceRole, targetRole]);
}

/**
 * Remove a single escalation chain entry.
 */
export async function removeEscalationChain(
  sourceRole: string,
  targetRole: string,
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_ESCALATION_CHAIN, [sourceRole, targetRole]);
  return (rowCount ?? 0) > 0;
}

/**
 * Replace all escalation targets for a source role.
 */
export async function replaceEscalationTargets(
  sourceRole: string,
  targets: string[],
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(ENSURE_ROLE_EXISTS, [sourceRole]);
    for (const target of targets) {
      await client.query(ENSURE_ROLE_EXISTS, [target]);
    }
    await client.query(DELETE_ESCALATION_CHAINS_BY_SOURCE, [sourceRole]);
    for (const target of targets) {
      await client.query(INSERT_ESCALATION_CHAIN, [sourceRole, target]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check whether a user can escalate from sourceRole to targetRole.
 * Superadmins and admin/admin can escalate to any role.
 * Others must hold the sourceRole AND the chain must exist.
 */
export async function canEscalateTo(
  userId: string,
  sourceRole: string,
  targetRole: string,
): Promise<boolean> {
  if (await hasGlobalEscalationAccess(userId)) return true;
  if (!(await hasRole(userId, sourceRole))) return false;

  const pool = getPool();
  const { rows } = await pool.query(CHECK_ESCALATION_CHAIN_EXISTS, [sourceRole, targetRole]);
  return rows.length > 0;
}

/**
 * List all distinct role names known to the system.
 * lt_roles is the canonical source — all other tables reference it via FK.
 */
export async function listDistinctRoles(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(LIST_ROLES);
  return rows.map((r: any) => r.role);
}

/**
 * List all roles with usage counts (users, escalation chains, workflows).
 */
export async function listRolesWithDetails(): Promise<RoleDetail[]> {
  const pool = getPool();
  const { rows } = await pool.query(LIST_ROLES_WITH_DETAILS);
  return rows;
}

/**
 * Create a standalone role entry. Returns true when the role was created by
 * this call, false when it already existed — seeders use this to write
 * default metadata exactly once and leave later admin edits alone.
 */
export async function createRole(role: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(ENSURE_ROLE_EXISTS, [role]);
  return (rowCount ?? 0) > 0;
}

/**
 * Update role metadata with PATCH semantics: a field omitted from the input
 * (undefined) keeps its current value; explicit null clears it (properties
 * resets to {}). One atomic UPDATE — see UPDATE_ROLE_METADATA.
 */
export async function updateRoleMetadata(
  role: string,
  input: UpdateRoleInput,
): Promise<RoleDetail | null> {
  const pool = getPool();
  const provided = (key: keyof UpdateRoleInput) => input[key] !== undefined;
  const upstreams = [...new Set(input.upstream_roles ?? [])].sort();
  const { rows } = await pool.query(UPDATE_ROLE_METADATA, [
    role,
    provided('title'), input.title ?? null,
    provided('description'), input.description ?? null,
    provided('form_schema'), input.form_schema != null ? JSON.stringify(input.form_schema) : null,
    provided('metadata_schema'), input.metadata_schema != null ? JSON.stringify(input.metadata_schema) : null,
    provided('properties'), input.properties != null ? JSON.stringify(input.properties) : null,
    provided('ops_visible'), input.ops_visible ?? null,
    provided('parent_role'), input.parent_role ?? null,
    provided('sla_minutes'), input.sla_minutes ?? null,
    provided('target_per_hour'), input.target_per_hour ?? null,
    provided('worker_count'), input.worker_count ?? null,
    provided('priority_threshold_minutes'), input.priority_threshold_minutes ?? null,
    provided('priority_facet'), input.priority_facet ?? null,
    input.change_summary ?? null,
    provided('upstream_roles'), upstreams,
  ]);
  if (!rows[0]) return null;
  // The statement's CTEs share one snapshot, so the returned row cannot see
  // the upstream sync it just performed — echo the write, or read when the
  // field wasn't touched.
  const upstream_roles = provided('upstream_roles')
    ? upstreams
    : await getRoleUpstreams(role);
  return { ...rows[0], upstream_roles };
}

/** Roles this station draws input from across other sequences. */
export async function getRoleUpstreams(role: string): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ROLE_UPSTREAMS, [role]);
  return rows.map((r: any) => r.upstream_role);
}

/**
 * List the schema version history for a role (newest first). Schemas are
 * elided — presence flags only; fetch a full snapshot via getRoleSchema.
 */
export async function listRoleSchemaVersions(role: string): Promise<RoleSchemaVersionSummary[]> {
  const pool = getPool();
  const { rows } = await pool.query(LIST_ROLE_SCHEMA_VERSIONS, [role]);
  return rows;
}

/**
 * Fetch a role's schema pair. With a version, reads the immutable snapshot
 * from lt_role_schemas; without one, reads the live (latest) columns — a role
 * that has never versioned its schema still answers with version null.
 * Returns null when the role (or the requested version) does not exist.
 */
export async function getRoleSchema(
  role: string,
  version?: number,
): Promise<RoleSchemaVersion | null> {
  const pool = getPool();
  const { rows } = version != null
    ? await pool.query(GET_ROLE_SCHEMA_VERSION, [role, version])
    : await pool.query(GET_ROLE_SCHEMA_CURRENT, [role]);
  if (!rows[0]) return null;
  return { ...rows[0], role };
}

/**
 * Fetch a role's live form_schema — the escalation form the dashboard renders.
 */
export async function getRoleFormSchema(role: string): Promise<Record<string, any> | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ROLE_FORM_SCHEMA, [role]);
  return rows[0]?.form_schema ?? null;
}

/**
 * Fetch metadata_schema for a role. Used at escalation creation time to
 * validate the caller-supplied metadata bag, and by the faceted-query UI
 * to surface expected keys before any data exists.
 */
export async function getRoleMetadataSchema(role: string): Promise<Record<string, any> | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ROLE_METADATA_SCHEMA, [role]);
  return rows[0]?.metadata_schema ?? null;
}

/**
 * Delete a role. Returns an error message if the role is referenced.
 */
export async function deleteRole(role: string): Promise<{ deleted: boolean; error?: string }> {
  const pool = getPool();

  const { rows: userRefs } = await pool.query(COUNT_USER_ROLE_REFS, [role]);
  if (userRefs[0].cnt > 0) {
    return { deleted: false, error: `Role is assigned to ${userRefs[0].cnt} user(s). Remove those assignments first.` };
  }

  const { rows: chainRefs } = await pool.query(COUNT_CHAIN_REFS, [role]);
  if (chainRefs[0].cnt > 0) {
    return { deleted: false, error: `Role is referenced in ${chainRefs[0].cnt} escalation chain(s). Remove those chains first.` };
  }

  const { rows: wfRefs } = await pool.query(COUNT_WORKFLOW_REFS, [role]);
  if (wfRefs[0].cnt > 0) {
    return { deleted: false, error: `Role is used by ${wfRefs[0].cnt} workflow config(s). Remove those references first.` };
  }

  const { rows: escRefs } = await pool.query(COUNT_ACTIVE_ESCALATION_REFS, [role]);
  if (escRefs[0].cnt > 0) {
    return { deleted: false, error: `Role has ${escRefs[0].cnt} active escalation(s). Resolve them first.` };
  }

  const { rowCount } = await pool.query(DELETE_ROLE, [role]);
  return { deleted: (rowCount ?? 0) > 0 };
}
