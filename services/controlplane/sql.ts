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

/**
 * Count pending (unprocessed) stream messages.
 * expired_at IS NULL = message has not been consumed yet.
 * Optional stream_name filter ($1 = interval, $2 = stream_name pattern or NULL).
 */
export const COUNT_PENDING = (schema: string) => `
  SELECT COUNT(*)::int AS count
  FROM "${schema}".streams
  WHERE expired_at IS NULL
    AND ($1::text IS NULL OR stream_name = $1)`;

/**
 * Count processed stream messages within a time interval.
 * $1 = interval, $2 = stream_name filter (NULL = all streams).
 */
export const COUNT_PROCESSED_SINCE = (schema: string) => `
  SELECT COUNT(*)::int AS count
  FROM "${schema}".streams
  WHERE expired_at IS NOT NULL
    AND expired_at > NOW() - $1::interval
    AND ($2::text IS NULL OR stream_name = $2)`;

/**
 * Volume breakdown by stream_name within a time interval.
 * $1 = interval, $2 = stream_name filter (NULL = all streams).
 */
export const VOLUME_BY_STREAM = (schema: string) => `
  SELECT stream_name, COUNT(*)::int AS count
  FROM "${schema}".streams
  WHERE expired_at IS NOT NULL
    AND expired_at > NOW() - $1::interval
    AND ($2::text IS NULL OR stream_name = $2)
  GROUP BY stream_name
  ORDER BY count DESC`;
