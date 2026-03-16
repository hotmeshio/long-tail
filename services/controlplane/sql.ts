// ─── Application discovery ──────────────────────────────────────────────────

/**
 * List all HotMesh applications from the global registry.
 * Keys follow the pattern `hmsh:a:{appId}`. Non-expired only.
 */
export const LIST_APPS = `
  SELECT DISTINCT key FROM hotmesh_applications
  WHERE key LIKE 'hmsh:a:%'
    AND (expiry IS NULL OR expiry > NOW())
  ORDER BY key`;

// ─── Stream statistics ──────────────────────────────────────────────────────
//
// HotMesh v0.11.0 split the single `streams` table into `engine_streams`
// (internal engine orchestration) and `worker_streams` (worker task messages).
// All queries now UNION both tables for aggregate statistics.

/**
 * Count pending (unprocessed) stream messages across both tables.
 * expired_at IS NULL = message has not been consumed yet.
 * $1 = stream_name filter (NULL = all streams).
 */
export const COUNT_PENDING = (schema: string) => `
  SELECT COUNT(*)::int AS count FROM (
    SELECT stream_name FROM "${schema}".engine_streams
    WHERE expired_at IS NULL
      AND ($1::text IS NULL OR stream_name = $1)
    UNION ALL
    SELECT stream_name FROM "${schema}".worker_streams
    WHERE expired_at IS NULL
      AND ($1::text IS NULL OR stream_name = $1)
  ) combined`;

/**
 * Count processed stream messages within a time interval.
 * $1 = interval, $2 = stream_name filter (NULL = all streams).
 */
export const COUNT_PROCESSED_SINCE = (schema: string) => `
  SELECT COUNT(*)::int AS count FROM (
    SELECT stream_name FROM "${schema}".engine_streams
    WHERE expired_at IS NOT NULL
      AND expired_at > NOW() - $1::interval
      AND ($2::text IS NULL OR stream_name = $2)
    UNION ALL
    SELECT stream_name FROM "${schema}".worker_streams
    WHERE expired_at IS NOT NULL
      AND expired_at > NOW() - $1::interval
      AND ($2::text IS NULL OR stream_name = $2)
  ) combined`;

/**
 * Volume breakdown by stream_name within a time interval.
 * $1 = interval, $2 = stream_name filter (NULL = all streams).
 */
export const VOLUME_BY_STREAM = (schema: string) => `
  SELECT stream_type, stream_name, COUNT(*)::int AS count FROM (
    SELECT 'engine' AS stream_type, stream_name FROM "${schema}".engine_streams
    WHERE expired_at IS NOT NULL
      AND expired_at > NOW() - $1::interval
      AND ($2::text IS NULL OR stream_name = $2)
    UNION ALL
    SELECT 'worker' AS stream_type, stream_name FROM "${schema}".worker_streams
    WHERE expired_at IS NOT NULL
      AND expired_at > NOW() - $1::interval
      AND ($2::text IS NULL OR stream_name = $2)
  ) combined
  GROUP BY stream_type, stream_name
  ORDER BY stream_type, count DESC`;
