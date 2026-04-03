/**
 * Resolve an LTEnvelopePrincipal from external_id or UUID in a single query.
 *
 * Called at the front door (API routes, cron) — never inside workflows.
 * Uses a LEFT JOIN to fetch user + roles in one round-trip.
 *
 * Accepts either:
 * - external_id (e.g., 'superadmin', 'lt-system')
 * - UUID id (e.g., '76d28d6c-...' — as stored in JWT userId)
 */

import { getPool } from '../db';
import type { LTEnvelopePrincipal } from '../../types/envelope';

/** UUID v4 pattern for distinguishing UUIDs from external_ids. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fetch user + roles by external_id OR id in one query. */
const GET_USER_WITH_ROLES_FLEXIBLE = `
  SELECT u.id, u.external_id, u.display_name, u.status, u.metadata,
         r.role, r.type AS role_type
  FROM lt_users u
  LEFT JOIN lt_user_roles r ON r.user_id = u.id
  WHERE u.external_id = $1 OR u.id::text = $1
  ORDER BY r.created_at`;

const ROLE_TYPE_PRIORITY: Record<string, number> = { superadmin: 3, admin: 2, member: 1 };

export async function resolvePrincipal(
  identifier: string,
): Promise<LTEnvelopePrincipal | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_USER_WITH_ROLES_FLEXIBLE, [identifier]);
  if (rows.length === 0) return null;

  const user = rows[0];
  const roleNames: string[] = [];
  let highestPriority = 0;
  let highestType: string | undefined;

  for (const row of rows) {
    if (row.role) {
      roleNames.push(row.role);
      const priority = ROLE_TYPE_PRIORITY[row.role_type] ?? 0;
      if (priority > highestPriority) {
        highestPriority = priority;
        highestType = row.role_type;
      }
    }
  }

  // Use external_id as the canonical identifier (stable, human-readable)
  return {
    id: user.external_id,
    type: (user.metadata as any)?.account_type ?? 'user',
    displayName: user.display_name ?? undefined,
    roles: roleNames,
    roleType: highestType,
  };
}
