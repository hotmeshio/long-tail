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
 */
export async function listDistinctRoles(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT role FROM (
       SELECT role FROM lt_user_roles
       UNION
       SELECT source_role AS role FROM lt_config_role_escalations
       UNION
       SELECT target_role AS role FROM lt_config_role_escalations
     ) AS all_roles
     ORDER BY role`,
  );
  return rows.map((r: any) => r.role);
}
