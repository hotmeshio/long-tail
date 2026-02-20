import { getPool } from './db';
import type { LTUserRecord, LTUserRole, LTUserStatus } from '../types';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateUserInput {
  external_id: string;
  email?: string;
  display_name?: string;
  status?: LTUserStatus;
  metadata?: Record<string, any>;
  roles?: { role: string; type: string }[];
}

export interface UpdateUserInput {
  email?: string;
  display_name?: string;
  status?: LTUserStatus;
  metadata?: Record<string, any>;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function attachRoles(user: any): Promise<LTUserRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT role, type, created_at FROM lt_user_roles WHERE user_id = $1 ORDER BY created_at',
    [user.id],
  );
  return { ...user, roles: rows };
}

async function attachRolesToMany(users: any[]): Promise<LTUserRecord[]> {
  if (users.length === 0) return [];
  const pool = getPool();
  const ids = users.map((u) => u.id);
  const { rows } = await pool.query(
    'SELECT user_id, role, type, created_at FROM lt_user_roles WHERE user_id = ANY($1) ORDER BY created_at',
    [ids],
  );
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
  const { rows } = await pool.query(
    `INSERT INTO lt_users (external_id, email, display_name, status, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.external_id,
      input.email || null,
      input.display_name || null,
      input.status || 'active',
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  const user = rows[0];

  if (input.roles && input.roles.length > 0) {
    for (const r of input.roles) {
      await pool.query(
        `INSERT INTO lt_user_roles (user_id, role, type) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [user.id, r.role, r.type],
      );
    }
  }

  return attachRoles(user);
}

export async function getUser(id: string): Promise<LTUserRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM lt_users WHERE id = $1', [id]);
  if (!rows[0]) return null;
  return attachRoles(rows[0]);
}

export async function getUserByExternalId(externalId: string): Promise<LTUserRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_users WHERE external_id = $1',
    [externalId],
  );
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
  const { rowCount } = await pool.query(
    'DELETE FROM lt_users WHERE id = $1',
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function listUsers(filters: {
  role?: string;
  roleType?: string;
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

// ─── Role management ──────────────────────────────────────────────────────────

export async function addUserRole(
  userId: string,
  role: string,
  type: string,
): Promise<LTUserRole> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO lt_user_roles (user_id, role, type) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, role) DO UPDATE SET type = EXCLUDED.type
     RETURNING role, type, created_at`,
    [userId, role, type],
  );
  return rows[0];
}

export async function removeUserRole(userId: string, role: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'DELETE FROM lt_user_roles WHERE user_id = $1 AND role = $2',
    [userId, role],
  );
  return (rowCount ?? 0) > 0;
}

export async function getUserRoles(userId: string): Promise<LTUserRole[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT role, type, created_at FROM lt_user_roles WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );
  return rows;
}

export async function hasRole(userId: string, role: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT 1 FROM lt_user_roles WHERE user_id = $1 AND role = $2 LIMIT 1',
    [userId, role],
  );
  return rows.length > 0;
}

export async function hasRoleType(userId: string, type: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT 1 FROM lt_user_roles WHERE user_id = $1 AND type = $2 LIMIT 1',
    [userId, type],
  );
  return rows.length > 0;
}

export async function isUserAdmin(userId: string): Promise<boolean> {
  return hasRoleType(userId, 'admin');
}
