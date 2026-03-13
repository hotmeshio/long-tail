import bcrypt from 'bcryptjs';

import { getPool } from '../db';
import type { LTUserRecord, LTUserRole, LTRoleType, LTUserStatus } from '../../types';

import {
  DELETE_USER_BY_ID,
  ENSURE_ROLE_EXISTS,
  GET_ROLES_BY_USER_ID,
  GET_ROLES_BY_USER_IDS,
  GET_USER_BY_EXTERNAL_ID,
  GET_USER_BY_ID,
  INSERT_USER,
  INSERT_USER_ROLE_IGNORE,
} from './sql';
import type { CreateUserInput, UpdateUserInput } from './types';

// ─── Private helpers (exported for internal use by auth.ts) ──────────────────

export async function attachRoles(user: any): Promise<LTUserRecord> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ROLES_BY_USER_ID, [user.id]);
  return { ...user, roles: rows };
}

async function attachRolesToMany(users: any[]): Promise<LTUserRecord[]> {
  if (users.length === 0) return [];
  const pool = getPool();
  const ids = users.map((u) => u.id);
  const { rows } = await pool.query(GET_ROLES_BY_USER_IDS, [ids]);
  const roleMap = new Map<string, LTUserRole[]>();
  for (const row of rows) {
    const list = roleMap.get(row.user_id) || [];
    list.push({ role: row.role, type: row.type, created_at: row.created_at });
    roleMap.set(row.user_id, list);
  }
  return users.map((u) => ({ ...u, roles: roleMap.get(u.id) || [] }));
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createUser(input: CreateUserInput): Promise<LTUserRecord> {
  const pool = getPool();
  const passwordHash = input.password
    ? await bcrypt.hash(input.password, 10)
    : null;
  const { rows } = await pool.query(INSERT_USER, [
      input.external_id,
      input.email || null,
      input.display_name || null,
      input.status || 'active',
      input.metadata ? JSON.stringify(input.metadata) : null,
      passwordHash,
    ],
  );
  const user = rows[0];

  if (input.roles && input.roles.length > 0) {
    for (const r of input.roles) {
      // Ensure the role exists in lt_roles (FK constraint)
      await pool.query(ENSURE_ROLE_EXISTS, [r.role]);
      await pool.query(INSERT_USER_ROLE_IGNORE, [user.id, r.role, r.type]);
    }
  }

  return attachRoles(user);
}

export async function getUser(id: string): Promise<LTUserRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_USER_BY_ID, [id]);
  if (!rows[0]) return null;
  return attachRoles(rows[0]);
}

export async function getUserByExternalId(externalId: string): Promise<LTUserRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_USER_BY_EXTERNAL_ID, [externalId]);
  if (!rows[0]) return null;
  return attachRoles(rows[0]);
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
): Promise<LTUserRecord | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (input.email !== undefined) {
    sets.push(`email = $${idx++}`);
    values.push(input.email);
  }
  if (input.display_name !== undefined) {
    sets.push(`display_name = $${idx++}`);
    values.push(input.display_name);
  }
  if (input.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(input.status);
  }
  if (input.metadata !== undefined) {
    sets.push(`metadata = $${idx++}`);
    values.push(JSON.stringify(input.metadata));
  }

  if (sets.length === 0) {
    return getUser(id);
  }

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE lt_users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  if (!rows[0]) return null;
  return attachRoles(rows[0]);
}

export async function deleteUser(id: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_USER_BY_ID, [id]);
  return (rowCount ?? 0) > 0;
}

export async function listUsers(filters: {
  role?: string;
  roleType?: LTRoleType;
  status?: LTUserStatus;
  limit?: number;
  offset?: number;
}): Promise<{ users: LTUserRecord[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;
  let needsJoin = false;

  if (filters.role) {
    needsJoin = true;
    conditions.push(`r.role = $${idx++}`);
    values.push(filters.role);
  }
  if (filters.roleType) {
    needsJoin = true;
    conditions.push(`r.type = $${idx++}`);
    values.push(filters.roleType);
  }
  if (filters.status) {
    conditions.push(`u.status = $${idx++}`);
    values.push(filters.status);
  }

  const join = needsJoin ? 'INNER JOIN lt_user_roles r ON r.user_id = u.id' : '';
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(DISTINCT u.id) FROM lt_users u ${join} ${where}`, values),
    pool.query(
      `SELECT DISTINCT u.* FROM lt_users u ${join} ${where} ORDER BY u.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    users: await attachRolesToMany(dataResult.rows),
    total: parseInt(countResult.rows[0].count, 10),
  };
}
