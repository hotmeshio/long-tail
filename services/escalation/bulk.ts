import { onlyUuids } from '../../lib/uuid';
import type { LTEscalationRecord } from '../../types';

import { getPool } from '../../lib/db';
import { escalations, ensureEscalationCompatView } from './client';
import { toEscalationRecords } from './map';
import { BULK_REASSIGN, BULK_UNASSIGN } from './sql';

/** One row touched by a reassign/unassign, with its pre-update assignee. */
export interface AssignmentChange {
  id: string;
  role: string;
  prior_assignee: string | null;
}

/**
 * Bulk claim escalations for a user.
 * Items already claimed by another active user are skipped.
 */
export async function bulkClaimEscalations(
  ids: string[],
  userId: string,
  durationMinutes: number = 30,
): Promise<{ claimed: number; skipped: number }> {
  ids = onlyUuids(ids);
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
  ids = onlyUuids(ids);
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
 * Bulk assign by query: one atomic UPDATE selects and claims every pending,
 * claimable row matching role + facet containment — no search-then-assign
 * window. A row that re-parks between a search and an ids-assign is invisible
 * to the ids form but claimed by this one. Returns the assigned row ids so
 * callers can publish per-row events.
 */
export async function bulkAssignEscalationsByQuery(
  query: { role: string; facets?: Record<string, unknown> },
  targetUserId: string,
  durationMinutes: number = 30,
): Promise<{ assigned: number; ids: string[] }> {
  const client = await escalations();
  const { claimed, entries } = await client.claimManyByQuery({
    query: { role: query.role, metadata: query.facets },
    assignee: targetUserId,
    durationMinutes,
  });
  return { assigned: claimed, ids: entries.map((e) => e.id) };
}

/**
 * Reassign pending rows to a user, INCLUDING rows under a live claim — the
 * management override plain assign is not (claimMany skips live claims). One
 * guarded statement; rows not returned were terminal or missing. Each
 * returned row carries its pre-update assignee for the event.
 */
export async function bulkReassignEscalations(
  ids: string[],
  targetUserId: string,
  durationMinutes: number = 30,
): Promise<{ assigned: number; skipped: number; changes: AssignmentChange[] }> {
  ids = onlyUuids(ids);
  if (ids.length === 0) return { assigned: 0, skipped: 0, changes: [] };
  await ensureEscalationCompatView();
  const { rows } = await getPool().query(BULK_REASSIGN, [ids, targetUserId, durationMinutes]);
  const changes = rows.map((r: any) => ({
    id: r.id,
    role: r.role,
    prior_assignee: r.prior_assignee ?? null,
  }));
  return { assigned: rows.length, skipped: ids.length - rows.length, changes };
}

/**
 * Return pending claimed rows to the available pool (admin override of
 * someone else's claim — self-return stays the release verb). One guarded
 * statement; unclaimed and terminal rows are skipped.
 */
export async function bulkUnassignEscalations(
  ids: string[],
): Promise<{ unassigned: number; skipped: number; changes: AssignmentChange[] }> {
  ids = onlyUuids(ids);
  if (ids.length === 0) return { unassigned: 0, skipped: 0, changes: [] };
  await ensureEscalationCompatView();
  const { rows } = await getPool().query(BULK_UNASSIGN, [ids]);
  const changes = rows.map((r: any) => ({
    id: r.id,
    role: r.role,
    prior_assignee: r.prior_assignee ?? null,
  }));
  return { unassigned: rows.length, skipped: ids.length - rows.length, changes };
}

/**
 * Bulk reassign escalations to a different role.
 * Clears assignment on all affected rows.
 */
export async function bulkEscalateToRole(
  ids: string[],
  targetRole: string,
): Promise<number> {
  ids = onlyUuids(ids);
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
  ids = onlyUuids(ids);
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
  ids = onlyUuids(ids);
  if (ids.length === 0) return [];
  const client = await escalations();
  const resolved = await client.resolveMany({
    ids,
    resolverPayload: { _lt: { needsTriage: true, ...(hint ? { hint } : {}) } },
  });
  return toEscalationRecords(resolved);
}
