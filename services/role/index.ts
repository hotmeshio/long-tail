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
  COUNT_USER_ROLE_REFS,
  COUNT_CHAIN_REFS,
  COUNT_WORKFLOW_REFS,
  COUNT_ACTIVE_ESCALATION_REFS,
} from './sql';

import type { EscalationChain, RoleDetail, UpdateRoleInput } from './types';

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
 * Create a standalone role entry.
 */
export async function createRole(role: string): Promise<void> {
  const pool = getPool();
  await pool.query(ENSURE_ROLE_EXISTS, [role]);
}

/**
 * Update role metadata (title, description, form_schema, properties, ops_visible, parent_role).
 * Only fields present in the input are updated; omitted fields are left unchanged.
 * form_schema and parent_role are always set (null clears them).
 */
export async function updateRoleMetadata(
  role: string,
  input: UpdateRoleInput,
): Promise<RoleDetail | null> {
  const pool = getPool();
  const { rows } = await pool.query(UPDATE_ROLE_METADATA, [
    role,
    input.title ?? null,
    input.description ?? null,
    input.form_schema !== undefined ? JSON.stringify(input.form_schema) : null,
    input.properties !== undefined ? JSON.stringify(input.properties) : null,
    input.ops_visible ?? null,
    input.parent_role !== undefined ? input.parent_role : null,
  ]);
  return rows[0] ?? null;
}

/**
 * Fetch form_schema for a role (used as default escalation form when workflow
 * config does not specify a resolver_schema).
 */
export async function getRoleFormSchema(role: string): Promise<Record<string, any> | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ROLE_FORM_SCHEMA, [role]);
  return rows[0]?.form_schema ?? null;
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
