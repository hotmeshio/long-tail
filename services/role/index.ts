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
  COUNT_USER_ROLE_REFS,
  COUNT_CHAIN_REFS,
  COUNT_WORKFLOW_REFS,
  COUNT_ACTIVE_ESCALATION_REFS,
  GET_ROLE_CONFIG,
  UPSERT_ROLE_META,
  GET_ROLE_DIALS,
  UPSERT_ROLE_DIAL,
  DELETE_ROLE_DIAL,
} from './sql';
import { validateSchemaDocument } from '../../system/activities/schema-exchange';

import type { EscalationChain, RoleDetail, RoleConfig, RoleConfigPatch, RoleDial, RoleDialInput } from './types';

export type { EscalationChain, RoleDetail, RoleConfig, RoleConfigPatch, RoleDial, RoleDialInput } from './types';
export { ROLE_HOME_VIEWS, DEFAULT_HOME_VIEW, isRoleHomeView } from './constants';
export type { RoleHomeView } from './constants';

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

// ─── Role surface config (title / purpose / schema / home_view) ────────────

/**
 * Read a role's self-describing config. Returns null if the role is unknown.
 */
export async function getRoleConfig(role: string): Promise<RoleConfig | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ROLE_CONFIG, [role]);
  return rows[0] ?? null;
}

/**
 * Patch a role's config (title / purpose / metadata schema / home_view). Only
 * provided fields change; the others are preserved. A supplied metadata schema
 * is validated as a compilable JSON Schema BEFORE any write — an unusable schema
 * is rejected at the boundary, never persisted.
 */
export async function updateRoleConfig(role: string, patch: RoleConfigPatch): Promise<void> {
  if (patch.metadataSchema !== undefined && patch.metadataSchema !== null) {
    const result = validateSchemaDocument(patch.metadataSchema);
    if (!result.valid) {
      throw new Error(`Invalid metadata_schema: ${result.errors.join('; ')}`);
    }
  }
  const pool = getPool();
  await pool.query(UPSERT_ROLE_META, [
    role,
    patch.title ?? null,
    patch.purpose ?? null,
    patch.metadataSchema != null ? JSON.stringify(patch.metadataSchema) : null,
    patch.homeView ?? null,
  ]);
}

// ─── Role dials (goal rate / crew per station) ─────────────────────────────

/**
 * List a role's dials — one per station, each with its promised goal rate.
 */
export async function getRoleDials(role: string): Promise<RoleDial[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ROLE_DIALS, [role]);
  return rows;
}

/**
 * Upsert one station's per-unit TAT target (atomic ON CONFLICT; ensures the role FK).
 */
export async function upsertRoleDial(
  role: string,
  stationKey: string,
  dial: RoleDialInput,
): Promise<void> {
  const pool = getPool();
  await pool.query(UPSERT_ROLE_DIAL, [role, stationKey, dial.targetTatSeconds]);
}

/**
 * Remove one station's dial from a role. Returns false if it did not exist.
 */
export async function deleteRoleDial(role: string, stationKey: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_ROLE_DIAL, [role, stationKey]);
  return (rowCount ?? 0) > 0;
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
