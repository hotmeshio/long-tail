import { getPool } from '../../lib/db';

import { hasRoleType, getUserRoles } from './roles';
import { IS_GROUP_ADMIN } from './sql';

// ─── RBAC helpers ─────────────────────────────────────────────────────────────

/**
 * Is the user a superadmin? (global — can manage all users and roles)
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  return hasRoleType(userId, 'superadmin');
}

/**
 * Is the user an admin of a specific role group?
 * Returns true if the user has `type = 'admin'` or `type = 'superadmin'` for that role,
 * OR if the user is a global superadmin (superadmin on any role).
 */
export async function isGroupAdmin(userId: string, role: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(IS_GROUP_ADMIN, [userId, role]);
  return rows.length > 0;
}

/**
 * Can the actor manage members of the given role?
 * Superadmins can manage any role. Admins can manage roles they belong to.
 */
export async function canManageRole(actorId: string, role: string): Promise<boolean> {
  return isGroupAdmin(actorId, role);
}

/**
 * Can this user act on escalations across all roles?
 *
 * True for:
 * - superadmin (any role with type 'superadmin')
 * - admin/admin (the named 'admin' role with type 'admin')
 *
 * These users see all escalations, can claim/resolve/escalate across
 * all roles, and can perform bulk actions.
 */
export async function hasGlobalEscalationAccess(userId: string): Promise<boolean> {
  if (await isSuperAdmin(userId)) return true;
  const roles = await getUserRoles(userId);
  return roles.some((r) => r.role === 'admin' && r.type === 'admin');
}

/**
 * Batch check: does the user have admin type for ALL specified roles?
 * Single query — replaces the N+1 loop in checkBulkPermission.
 */
export async function hasRolesAsAdmin(userId: string, roles: string[]): Promise<boolean> {
  if (!roles.length) return true;
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT role)::int AS cnt
     FROM lt_user_roles
     WHERE user_id = $1 AND role = ANY($2::text[]) AND type IN ('admin', 'superadmin')`,
    [userId, roles],
  );
  return (rows[0]?.cnt ?? 0) >= roles.length;
}
