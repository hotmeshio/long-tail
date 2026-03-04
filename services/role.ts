import { getPool } from './db';
import { isSuperAdmin, hasRole } from './user';

export interface EscalationChain {
  source_role: string;
  target_role: string;
}

/**
 * Get the roles a given source role can escalate to.
 */
export async function getEscalationTargets(sourceRole: string): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT target_role FROM lt_config_role_escalations WHERE source_role = $1 ORDER BY target_role',
    [sourceRole],
  );
  return rows.map((r: any) => r.target_role);
}

/**
 * Get all escalation chain pairs.
 */
export async function getAllEscalationChains(): Promise<EscalationChain[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT source_role, target_role FROM lt_config_role_escalations ORDER BY source_role, target_role',
  );
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
  await pool.query(
    `INSERT INTO lt_config_role_escalations (source_role, target_role)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [sourceRole, targetRole],
  );
}

/**
 * Remove a single escalation chain entry.
 */
export async function removeEscalationChain(
  sourceRole: string,
  targetRole: string,
): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'DELETE FROM lt_config_role_escalations WHERE source_role = $1 AND target_role = $2',
    [sourceRole, targetRole],
  );
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
    await client.query(
      'DELETE FROM lt_config_role_escalations WHERE source_role = $1',
      [sourceRole],
    );
    for (const target of targets) {
      await client.query(
        `INSERT INTO lt_config_role_escalations (source_role, target_role)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [sourceRole, target],
      );
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
 * Superadmins can escalate to any role.
 * Others must hold the sourceRole AND the chain must exist.
 */
export async function canEscalateTo(
  userId: string,
  sourceRole: string,
  targetRole: string,
): Promise<boolean> {
  // Superadmin bypasses all checks
  if (await isSuperAdmin(userId)) return true;

  // User must hold the source role
  if (!(await hasRole(userId, sourceRole))) return false;

  // Chain must exist
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT 1 FROM lt_config_role_escalations WHERE source_role = $1 AND target_role = $2',
    [sourceRole, targetRole],
  );
  return rows.length > 0;
}

/**
 * List all distinct role names known to the system.
 * lt_roles is the canonical source — all other tables reference it via FK.
 */
export async function listDistinctRoles(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT role FROM lt_roles ORDER BY role',
  );
  return rows.map((r: any) => r.role);
}

export interface RoleDetail {
  role: string;
  user_count: number;
  chain_count: number;
  workflow_count: number;
}

/**
 * List all roles with usage counts (users, escalation chains, workflows).
 */
export async function listRolesWithDetails(): Promise<RoleDetail[]> {
  const pool = getPool();
  const { rows } = await pool.query(`
    WITH
    user_counts AS (
      SELECT role, COUNT(DISTINCT user_id)::int AS cnt
      FROM lt_user_roles
      GROUP BY role
    ),
    chain_counts AS (
      SELECT role, COUNT(*)::int AS cnt
      FROM (
        SELECT source_role AS role FROM lt_config_role_escalations
        UNION ALL
        SELECT target_role AS role FROM lt_config_role_escalations
      ) c
      GROUP BY role
    ),
    workflow_counts AS (
      SELECT role, COUNT(*)::int AS cnt
      FROM lt_config_roles
      GROUP BY role
    )
    SELECT
      r.role,
      COALESCE(uc.cnt, 0) AS user_count,
      COALESCE(cc.cnt, 0) AS chain_count,
      COALESCE(wc.cnt, 0) AS workflow_count
    FROM lt_roles r
    LEFT JOIN user_counts uc ON uc.role = r.role
    LEFT JOIN chain_counts cc ON cc.role = r.role
    LEFT JOIN workflow_counts wc ON wc.role = r.role
    ORDER BY r.role
  `);
  return rows;
}

/**
 * Create a standalone role entry.
 */
export async function createRole(role: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO lt_roles (role) VALUES ($1) ON CONFLICT DO NOTHING`,
    [role],
  );
}

/**
 * Delete a role. Returns an error message if the role is referenced.
 */
export async function deleteRole(role: string): Promise<{ deleted: boolean; error?: string }> {
  const pool = getPool();

  // Check references in lt_user_roles
  const { rows: userRefs } = await pool.query(
    'SELECT COUNT(*)::int AS cnt FROM lt_user_roles WHERE role = $1',
    [role],
  );
  if (userRefs[0].cnt > 0) {
    return { deleted: false, error: `Role is assigned to ${userRefs[0].cnt} user(s). Remove those assignments first.` };
  }

  // Check references in lt_config_role_escalations
  const { rows: chainRefs } = await pool.query(
    'SELECT COUNT(*)::int AS cnt FROM lt_config_role_escalations WHERE source_role = $1 OR target_role = $1',
    [role],
  );
  if (chainRefs[0].cnt > 0) {
    return { deleted: false, error: `Role is referenced in ${chainRefs[0].cnt} escalation chain(s). Remove those chains first.` };
  }

  // Check references in lt_config_roles (workflow configs)
  const { rows: wfRefs } = await pool.query(
    'SELECT COUNT(*)::int AS cnt FROM lt_config_roles WHERE role = $1',
    [role],
  );
  if (wfRefs[0].cnt > 0) {
    return { deleted: false, error: `Role is used by ${wfRefs[0].cnt} workflow config(s). Remove those references first.` };
  }

  // Check active escalations assigned to this role
  const { rows: escRefs } = await pool.query(
    "SELECT COUNT(*)::int AS cnt FROM lt_escalations WHERE role = $1 AND status IN ('pending', 'claimed')",
    [role],
  );
  if (escRefs[0].cnt > 0) {
    return { deleted: false, error: `Role has ${escRefs[0].cnt} active escalation(s). Resolve them first.` };
  }

  // Safe to delete from lt_roles
  const { rowCount } = await pool.query(
    'DELETE FROM lt_roles WHERE role = $1',
    [role],
  );
  return { deleted: (rowCount ?? 0) > 0 };
}
