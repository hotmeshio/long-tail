import { getPool } from '../../lib/db';
import type { LTEscalationRecord } from '../../types';

import {
  BULK_CLAIM,
  BULK_ASSIGN,
  BULK_ESCALATE_TO_ROLE,
  BULK_RESOLVE_FOR_TRIAGE,
} from './sql';

/**
 * Bulk claim escalations for a user.
 * Items already claimed by another active user are skipped.
 */
export async function bulkClaimEscalations(
  ids: string[],
  userId: string,
  durationMinutes: number = 30,
): Promise<{ claimed: number; skipped: number }> {
  if (ids.length === 0) return { claimed: 0, skipped: 0 };
  const pool = getPool();
  const { rowCount } = await pool.query(
    BULK_CLAIM,
    [userId, durationMinutes, ids],
  );
  const claimed = rowCount ?? 0;
  return { claimed, skipped: ids.length - claimed };
}

/**
 * Bulk assign escalations to a specific user (admin action).
 * Items already claimed by another active user are skipped.
 */
export async function bulkAssignEscalations(
  ids: string[],
  targetUserId: string,
  durationMinutes: number = 30,
): Promise<{ assigned: number; skipped: number }> {
  if (ids.length === 0) return { assigned: 0, skipped: 0 };
  const pool = getPool();
  const { rowCount } = await pool.query(
    BULK_ASSIGN,
    [targetUserId, durationMinutes, ids],
  );
  const assigned = rowCount ?? 0;
  return { assigned, skipped: ids.length - assigned };
}

/**
 * Bulk reassign escalations to a different role.
 * Clears assignment on all affected rows.
 */
export async function bulkEscalateToRole(
  ids: string[],
  targetRole: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const pool = getPool();
  const { rowCount } = await pool.query(
    BULK_ESCALATE_TO_ROLE,
    [targetRole, ids],
  );
  return rowCount ?? 0;
}

/**
 * Bulk resolve escalations for AI triage.
 * Returns full records so the caller can start triage workflows.
 */
export async function bulkResolveForTriage(
  ids: string[],
  hint?: string,
): Promise<LTEscalationRecord[]> {
  if (ids.length === 0) return [];
  const pool = getPool();
  const resolverPayload = JSON.stringify({
    _lt: { needsTriage: true, ...(hint ? { hint } : {}) },
  });
  const { rows } = await pool.query(
    BULK_RESOLVE_FOR_TRIAGE,
    [resolverPayload, ids],
  );
  return rows;
}
