import type { LTEscalationRecord } from '../../types';

import { escalations } from './client';
import { toEscalationRecords } from './map';

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
  const client = await escalations();
  return client.claimMany({ ids, assignee: userId, durationMinutes });
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
  const client = await escalations();
  const { claimed, skipped } = await client.claimMany({
    ids,
    assignee: targetUserId,
    durationMinutes,
  });
  return { assigned: claimed, skipped };
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
  const client = await escalations();
  return client.escalateManyToRole({ ids, targetRole });
}

/**
 * Bulk cancel escalations. Each row is cancelled individually; rows already in
 * a terminal state are silently skipped by the SDK. Returns the count
 * successfully cancelled.
 */
export async function bulkCancelEscalations(
  ids: string[],
): Promise<{ cancelled: number; skipped: number }> {
  if (ids.length === 0) return { cancelled: 0, skipped: 0 };
  const client = await escalations();
  let cancelled = 0;
  let skipped = 0;
  await Promise.all(
    ids.map(async (id) => {
      const result = await client.cancel(id);
      if (result.ok) cancelled++;
      else skipped++;
    }),
  );
  return { cancelled, skipped };
}

/**
 * Bulk resolve escalations for AI triage.
 * Returns full records so the caller can start triage workflows. No signal is
 * delivered — the triage workflow takes over handling. Rows backing a live
 * `condition()` waiter (`signal_key` set) are skipped by the store and stay
 * `pending`; only the returned rows enter triage.
 */
export async function bulkResolveForTriage(
  ids: string[],
  hint?: string,
): Promise<LTEscalationRecord[]> {
  if (ids.length === 0) return [];
  const client = await escalations();
  const resolved = await client.resolveMany({
    ids,
    resolverPayload: { _lt: { needsTriage: true, ...(hint ? { hint } : {}) } },
  });
  return toEscalationRecords(resolved);
}
