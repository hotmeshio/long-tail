import { getPool } from '../../lib/db';
import type { LTReadScope, LTRoleType, LTUserRole, LTWriteScope } from '../../types';

import {
  DELETE_USER_ROLE,
  ENSURE_ROLE_EXISTS,
  GET_ROLES_BY_USER_ID,
  HAS_ROLE,
  HAS_ROLE_TYPE,
  UPSERT_USER_ROLE,
} from './sql';
import { DEFAULT_READ_SCOPE, DEFAULT_WRITE_SCOPE, effectiveScope } from './scope';
import { VALID_ROLE_TYPES } from './types';

// ─── Role management ──────────────────────────────────────────────────────────

export function isValidRoleType(type: string): type is LTRoleType {
  return VALID_ROLE_TYPES.includes(type as LTRoleType);
}

/** Optional work-surface scope for a membership. Defaults to ('all','all') = full worker. */
export interface RoleScopeInput {
  read_scope?: LTReadScope;
  write_scope?: LTWriteScope;
}

export async function addUserRole(
  userId: string,
  role: string,
  type: LTRoleType,
  scope?: RoleScopeInput,
): Promise<LTUserRole> {
  // admin/superadmin always store ('all','all'); members store the requested scope.
  const eff = effectiveScope(
    type,
    scope?.read_scope ?? DEFAULT_READ_SCOPE,
    scope?.write_scope ?? DEFAULT_WRITE_SCOPE,
  );
  const pool = getPool();
  // Ensure-role (FK target) and the scoped user-role upsert commit together so a
  // failure between them cannot leave the FK target without its assignment.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(ENSURE_ROLE_EXISTS, [role]);
    const { rows } = await client.query(UPSERT_USER_ROLE, [userId, role, type, eff.read, eff.write]);
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function removeUserRole(userId: string, role: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_USER_ROLE, [userId, role]);
  return (rowCount ?? 0) > 0;
}

export async function getUserRoles(userId: string): Promise<LTUserRole[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ROLES_BY_USER_ID, [userId]);
  return rows;
}

export async function hasRole(userId: string, role: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(HAS_ROLE, [userId, role]);
  return rows.length > 0;
}

export async function hasRoleType(userId: string, type: LTRoleType): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(HAS_ROLE_TYPE, [userId, type]);
  return rows.length > 0;
}
