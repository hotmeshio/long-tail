/**
 * Resolve an LTEnvelopePrincipal from external_id in a single query.
 *
 * Called at the front door (API routes, cron) — never inside workflows.
 * Uses a LEFT JOIN to fetch user + roles in one round-trip.
 */

import { getPool } from '../db';
import { GET_USER_WITH_ROLES } from '../user/sql';
import type { LTEnvelopePrincipal } from '../../types/envelope';

const ROLE_TYPE_PRIORITY: Record<string, number> = { superadmin: 3, admin: 2, member: 1 };

export async function resolvePrincipal(
  externalId: string,
): Promise<LTEnvelopePrincipal | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_USER_WITH_ROLES, [externalId]);
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

  return {
    id: externalId,
    type: (user.metadata as any)?.account_type ?? 'user',
    displayName: user.display_name ?? undefined,
    roles: roleNames,
    roleType: highestType,
  };
}
