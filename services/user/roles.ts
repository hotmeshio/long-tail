import { getPool } from '../db';
import type { LTUserRole, LTRoleType } from '../../types';

import {
  DELETE_USER_ROLE,
  ENSURE_ROLE_EXISTS,
  GET_ROLES_BY_USER_ID,
  HAS_ROLE,
  HAS_ROLE_TYPE,
  UPSERT_USER_ROLE,
} from './sql';
import { VALID_ROLE_TYPES } from './types';

// ─── Role management ──────────────────────────────────────────────────────────

export function isValidRoleType(type: string): type is LTRoleType {
  return VALID_ROLE_TYPES.includes(type as LTRoleType);
}

export async function addUserRole(
  userId: string,
  role: string,
  type: LTRoleType,
): Promise<LTUserRole> {
  const pool = getPool();
  // Ensure the role exists in lt_roles (FK constraint)
  await pool.query(ENSURE_ROLE_EXISTS, [role]);
  const { rows } = await pool.query(UPSERT_USER_ROLE, [userId, role, type]);
  return rows[0];
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
