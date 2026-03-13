// ── Job queries ─────────────────────────────────────────────────────────────

export const GET_JOB_BY_KEY = `\
SELECT key, status, context, created_at, updated_at, expired_at, is_live
  FROM durable.jobs
 WHERE key = $1
 LIMIT 1`;

export const GET_JOB_ATTRIBUTES = `\
SELECT field, value
  FROM durable.jobs_attributes
 WHERE job_id = $1
 ORDER BY field`;

// ── Symbol queries ──────────────────────────────────────────────────────────

export const RESOLVE_SYMBOL = `\
SELECT value
  FROM durable.symbols
 WHERE key = $1 AND field = $2
 LIMIT 1`;

// ── Activity enrichment queries ─────────────────────────────────────────────

export const GET_ACTIVITY_INPUTS = `\
SELECT j.key, ja.value
  FROM durable.jobs j
  JOIN durable.jobs_attributes ja ON ja.job_id = j.id
 WHERE j.key LIKE $1
   AND ja.field = $2`;

// Child workflow input lookups use a parameterized IN(...) clause built at
// runtime (exact-match efficiency over LIKE), so the query is constructed
// inline in enrichment.ts rather than exported here.
