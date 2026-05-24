// ─── Stream message browsing ───────────────────────────────────────────────
//
// Paginated queries across engine_streams and worker_streams tables.
// Both tables are HASH-partitioned on stream_name (8 partitions each).
// Status is derived from timestamp columns:
//   dead_lettered_at IS NOT NULL → 'dead_lettered'
//   expired_at IS NOT NULL       → 'processed'
//   reserved_at IS NOT NULL      → 'claimed'
//   else                         → 'pending'

/** Allowed sort columns — whitelist prevents injection. */
export const VALID_SORT_COLUMNS: Record<string, string> = {
  created_at: 'created_at',
  stream_name: 'stream_name',
  priority: 'priority',
  id: 'id',
};

/** Allowed sort directions. */
export const VALID_SORT_ORDERS = new Set(['asc', 'desc']);

/**
 * Status derivation CASE expression, reused by both list and count queries.
 */
const STATUS_CASE = `
  CASE
    WHEN dead_lettered_at IS NOT NULL THEN 'dead_lettered'
    WHEN expired_at IS NOT NULL THEN 'processed'
    WHEN reserved_at IS NOT NULL THEN 'claimed'
    ELSE 'pending'
  END`;

/**
 * Shared WHERE clause for stream message filtering.
 *
 * Parameters:
 *   $1 = stream_name filter (NULL = all, otherwise ILIKE pattern)
 *   $2 = status filter (NULL = all, otherwise exact match)
 *   $3 = msg_type filter (NULL = all, worker-only)
 */
const WHERE_CLAUSE = `
  WHERE ($1::text IS NULL OR stream_name ILIKE $1)
    AND ($2::text IS NULL OR ${STATUS_CASE} = $2)`;

const WORKER_WHERE_CLAUSE = `
  WHERE ($1::text IS NULL OR stream_name ILIKE $1)
    AND ($2::text IS NULL OR ${STATUS_CASE} = $2)
    AND ($3::text IS NULL OR msg_type = $3)`;

/**
 * List stream messages with pagination, filtering, and sorting.
 *
 * Source is required — engine and worker streams are separate tables
 * with different schemas and must never be commingled in a single query.
 *
 * Parameters: $1 = stream_name, $2 = status, $3 = msg_type, $4 = limit, $5 = offset
 */
export function LIST_STREAM_MESSAGES(
  schema: string,
  sortColumn: string,
  sortOrder: string,
  source: 'engine' | 'worker',
): string {
  const select = source === 'engine'
    ? `SELECT
        id, 'engine' AS source, stream_name,
        message, ${STATUS_CASE} AS status,
        created_at, reserved_at, reserved_by, expired_at,
        dead_lettered_at, priority, visible_at,
        retry_attempt, max_retry_attempts,
        NULL AS workflow_name, NULL AS jid, NULL AS aid,
        NULL AS dad, NULL AS msg_type, NULL AS topic
      FROM "${schema}".engine_streams
      ${WHERE_CLAUSE}
        AND ($3::text IS NULL)`
    : `SELECT
        id, 'worker' AS source, stream_name,
        message, ${STATUS_CASE} AS status,
        created_at, reserved_at, reserved_by, expired_at,
        dead_lettered_at, priority, visible_at,
        retry_attempt, max_retry_attempts,
        workflow_name, jid, aid, dad, msg_type, topic
      FROM "${schema}".worker_streams
      ${WORKER_WHERE_CLAUSE}`;

  return `
    SELECT * FROM (${select}) AS q
    ORDER BY ${sortColumn} ${sortOrder}, id DESC
    LIMIT $4::int OFFSET $5::int`;
}

/**
 * Count stream messages matching the filter criteria.
 *
 * Parameters: $1 = stream_name, $2 = status, $3 = msg_type
 */
export function COUNT_STREAM_MESSAGES(
  schema: string,
  source: 'engine' | 'worker',
): string {
  const table = source === 'engine' ? 'engine_streams' : 'worker_streams';
  const where = source === 'engine'
    ? `${WHERE_CLAUSE} AND ($3::text IS NULL)`
    : WORKER_WHERE_CLAUSE;

  return `SELECT COUNT(*)::int AS count FROM "${schema}".${table} ${where}`;
}
