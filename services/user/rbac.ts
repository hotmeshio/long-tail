import { getPool } from '../../lib/db';

import { hasRoleType } from './roles';
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
