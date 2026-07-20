import { getPool } from '../../lib/db';

/**
 * Per-user preferences — a generic JSON store for presentation state (pinned
 * views are the first tenant, not the schema). Preferences carry URLs and UI
 * choices only, never data and never authorization.
 */

/** Server-side ceiling on the stored document (the API rejects beyond it). */
export const PREFERENCES_MAX_BYTES = 32 * 1024;

export async function getPreferences(userId: string): Promise<Record<string, unknown>> {
  const { rows } = await getPool().query(
    'SELECT preferences FROM lt_users WHERE id = $1',
    [userId],
  );
  return (rows[0]?.preferences as Record<string, unknown>) ?? {};
}

/**
 * Shallow-merge `patch` into the user's preferences in ONE guarded UPDATE:
 * top-level keys overwrite, a `null` value deletes its key, and the statement
 * refuses to commit a document over the size cap (returns null → 413 at the
 * API). No read-then-write — concurrent patches serialize on the row.
 */
export async function patchPreferences(
  userId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const deletions = Object.keys(patch).filter((k) => patch[k] === null);
  const additions: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null) additions[k] = v;
  }

  const { rows } = await getPool().query(
    `UPDATE lt_users u
     SET preferences = ((COALESCE(u.preferences, '{}'::jsonb) || $2::jsonb) - $3::text[]),
         updated_at = NOW()
     WHERE u.id = $1
       AND length(((COALESCE(u.preferences, '{}'::jsonb) || $2::jsonb) - $3::text[])::text) <= $4
     RETURNING u.preferences`,
    [userId, JSON.stringify(additions), deletions, PREFERENCES_MAX_BYTES],
  );
  return (rows[0]?.preferences as Record<string, unknown>) ?? null;
}
