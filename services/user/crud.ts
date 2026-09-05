import bcrypt from 'bcryptjs';

import { getPool } from '../../lib/db';
import type { LTUserRecord, LTUserRole, LTRoleType, LTUserStatus } from '../../types';

import {
  CREATE_USER_WITH_ROLES,
  DELETE_USER_BY_ID,
  GET_NAMES_BY_IDS,
  GET_ROLES_BY_USER_ID,
  GET_ROLES_BY_USER_IDS,
  GET_USER_BY_EMAIL,
  GET_USER_BY_EXTERNAL_ID,
  GET_USER_BY_ID,
  GET_USERS_BY_METADATA_VALUE,
  PATCH_USER_PROPERTIES,
  VERIFY_USER_BY_ID,
} from './sql';
import { onlyUuids } from '../../lib/uuid';
import { listScanSchemes } from '../scan-code';
import { SCAN_SCHEME_KINDS } from '../../types/scan-code';
import { DEFAULT_READ_SCOPE, DEFAULT_WRITE_SCOPE, effectiveScope } from './scope';
import type { CreateUserInput, UpdateUserInput, UserPropertyOps } from './types';

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
    list.push({
      role: row.role,
      type: row.type,
      read_scope: row.read_scope,
      write_scope: row.write_scope,
      created_at: row.created_at,
    });
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

  // One atomic statement creates the user, ensures the role FK targets, and links
  // the assignments — no partial-roles window, no per-role N+1. Roles + their
  // effective scope travel as parallel text[] arrays. admin/superadmin normalize
  // to ('all','all'); members store the requested scope.
  const roleNames = (input.roles || []).map((r) => r.role);
  const roleTypes = (input.roles || []).map((r) => r.type);
  const effScopes = (input.roles || []).map((r) =>
    effectiveScope(
      r.type,
      r.read_scope ?? DEFAULT_READ_SCOPE,
      r.write_scope ?? DEFAULT_WRITE_SCOPE,
    ),
  );
  const roleReadScopes = effScopes.map((e) => e.read);
  const roleWriteScopes = effScopes.map((e) => e.write);

  const { rows } = await pool.query(CREATE_USER_WITH_ROLES, [
      input.external_id,
      input.email || null,
      input.display_name || null,
      input.status || 'active',
      input.metadata ? JSON.stringify(input.metadata) : null,
      passwordHash,
      input.oauth_provider || null,
      input.oauth_provider_id || null,
      roleNames,
      roleTypes,
      roleReadScopes,
      roleWriteScopes,
    ],
  );

  return attachRoles(rows[0]);
}

export async function getUser(id: string): Promise<LTUserRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_USER_BY_ID, [id]);
  if (!rows[0]) return null;
  return attachRoles(rows[0]);
}

export interface UserNameRecord {
  id: string;
  display_name: string | null;
  external_id: string;
  email: string | null;
}

const MAX_NAME_LOOKUP = 200;

/**
 * Resolve many user ids to display fields in one query. Non-UUID input is
 * dropped before the SQL (a bad id is not-found, never a 500), ids are deduped,
 * and the batch is capped. Returns display fields only — never secrets, scopes,
 * or metadata.
 */
export async function getUserNames(ids: string[]): Promise<UserNameRecord[]> {
  const clean = [...new Set(onlyUuids(ids))].slice(0, MAX_NAME_LOOKUP);
  if (clean.length === 0) return [];
  const pool = getPool();
  const { rows } = await pool.query(GET_NAMES_BY_IDS, [clean]);
  return rows;
}

export async function getUserByExternalId(externalId: string): Promise<LTUserRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_USER_BY_EXTERNAL_ID, [externalId]);
  if (!rows[0]) return null;
  return attachRoles(rows[0]);
}

export async function getUserByEmail(email: string): Promise<LTUserRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_USER_BY_EMAIL, [email]);
  if (!rows[0]) return null;
  return attachRoles(rows[0]);
}

/**
 * Resolve an ACTIVE user by a metadata binding (e.g. metadata.badge_id).
 * Two users carrying the same value is a configuration fault, not a pick —
 * it throws so the binding gets fixed instead of misattributing work.
 */
export async function getUserByMetadataValue(
  key: string,
  value: string,
): Promise<LTUserRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_USERS_BY_METADATA_VALUE, [key, value]);
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error(`metadata binding "${key}" is ambiguous — multiple users carry the same value`);
  }
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
  if (input.password !== undefined) {
    sets.push(`password_hash = $${idx++}`);
    values.push(await bcrypt.hash(input.password, 10));
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

/** A property write that would create an ambiguous identity binding. */
export class UserPropertyConflictError extends Error {
  status = 409;
  constructor(key: string) {
    super(`"${key}" value is already bound to another active user`);
    this.name = 'UserPropertyConflictError';
  }
}

/** A malformed property patch — rejected before any write. */
export class UserPropertyValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'UserPropertyValidationError';
  }
}

/**
 * The lt_users.metadata keys the platform itself resolves identities against:
 * every enabled identity scan scheme's target_facet (e.g. badge_id). Writes
 * to these keys carry a uniqueness guard; the dashboard marks them as system
 * properties.
 */
export async function getIdentityPropertyKeys(): Promise<string[]> {
  const schemes = await listScanSchemes();
  return [...new Set(
    schemes
      .filter((s) => s.enabled && s.kind === SCAN_SCHEME_KINDS.IDENTITY)
      .map((s) => s.target_facet),
  )];
}

/**
 * Atomic per-key patch of the user's properties dictionary (lt_users.metadata).
 * One statement — never read-merge-write: concurrent patches of different
 * keys both land, a rename never opens a key-absent window, and deleting is
 * explicit (`remove`) — an absent key means keep. Precedence on collision:
 * set > rename > existing. Values are raw JSON, so numbers/booleans/objects
 * round-trip typed.
 *
 * Identity-binding keys (getIdentityPropertyKeys) additionally assert, in the
 * same statement, that no OTHER active user carries the value — the
 * write-side counterpart of getUserByMetadataValue's ambiguity throw.
 * A tripped guard raises UserPropertyConflictError (409).
 */
export async function patchUserProperties(
  id: string,
  ops: UserPropertyOps,
): Promise<LTUserRecord | null> {
  const set = ops.set ?? {};
  const remove = ops.remove ?? [];
  const rename = ops.rename ?? {};

  const setKeys = Object.keys(set);
  const renameEntries = Object.entries(rename);
  if (setKeys.length === 0 && remove.length === 0 && renameEntries.length === 0) {
    throw new UserPropertyValidationError('A property patch requires at least one set, remove, or rename');
  }
  for (const key of [...setKeys, ...remove, ...renameEntries.flat()]) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new UserPropertyValidationError('Property keys must be non-empty strings');
    }
  }
  for (const key of setKeys) {
    if (remove.includes(key)) {
      throw new UserPropertyValidationError(`"${key}" cannot be both set and removed in one patch`);
    }
  }
  for (const [prev, next] of renameEntries) {
    if (prev === next) {
      throw new UserPropertyValidationError(`Renaming "${prev}" to itself is not a change`);
    }
  }
  const renameTargets = renameEntries.map(([, next]) => next);
  if (new Set(renameTargets).size !== renameTargets.length) {
    throw new UserPropertyValidationError('Two properties cannot be renamed to the same key');
  }

  // Identity bindings resolve people — their values must be scalar and, for
  // ACTIVE users, unique. The guard rides the same statement.
  const identityKeys = await getIdentityPropertyKeys();
  const guard: Record<string, string> = {};
  for (const key of identityKeys) {
    if (key in set) {
      const value = set[key];
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new UserPropertyValidationError(`"${key}" is an identity binding — its value must be a string or number`);
      }
      guard[key] = String(value);
    }
  }

  const removeAll = [...new Set([...remove, ...renameEntries.map(([prev]) => prev)])];
  const renamePairs = renameEntries.map(([prev, next]) => ({ prev, next }));

  const pool = getPool();
  const { rows } = await pool.query(PATCH_USER_PROPERTIES, [
    id,
    removeAll,
    JSON.stringify(renamePairs),
    JSON.stringify(set),
    JSON.stringify(guard),
  ]);
  if (rows[0]) return attachRoles(rows[0]);

  const exists = await pool.query(VERIFY_USER_BY_ID, [id]);
  if (!exists.rows[0]) return null;
  // The user exists, so the identity guard is what blocked the write. Name
  // the first guarded key for the caller; the row was not touched.
  throw new UserPropertyConflictError(Object.keys(guard)[0] ?? 'identity binding');
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
  search?: string;
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
  if (filters.search) {
    // Server-side free-text over the user's display fields — one term, one param.
    const i = idx++;
    conditions.push(
      `(u.display_name ILIKE '%' || $${i} || '%' OR u.email ILIKE '%' || $${i} || '%' OR u.external_id ILIKE '%' || $${i} || '%')`,
    );
    values.push(filters.search);
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
