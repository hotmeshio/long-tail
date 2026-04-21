// SQL templates for mcp-runs queries.
// Schema placeholders (${schema}) are interpolated at call time
// because Postgres does not support parameterized schema names.

export const DISTINCT_ENTITIES_DURABLE = `
  SELECT DISTINCT entity FROM durable.jobs WHERE entity IS NOT NULL AND entity != '' ORDER BY entity`;

export const DISTINCT_ENTITIES = (schema: string) =>
  `SELECT DISTINCT entity FROM ${schema}.jobs WHERE entity IS NOT NULL AND entity != '' ORDER BY entity`;

export const ACTIVE_GRAPH_TOPICS =
  `SELECT DISTINCT graph_topic FROM lt_yaml_workflows WHERE app_id = $1 AND status IN ('active', 'deployed')`;

export const COUNT_JOBS = (schema: string, where: string) =>
  `SELECT COUNT(*) FROM ${schema}.jobs j ${where}`;

// ─── Execution builder ──────────────────────────────────────────���───────────

export const GET_JOB = (schema: string) =>
  `SELECT id, key, entity, status, created_at, updated_at, expired_at, is_live
   FROM ${schema}.jobs WHERE key = $1 LIMIT 1`;

export const GET_JOB_ATTRIBUTES = (schema: string) =>
  `SELECT symbol, dimension, value FROM ${schema}.jobs_attributes WHERE job_id = $1 ORDER BY symbol, dimension`;

// ─── Queries (queries.ts) ───────────────────────────────────────────────────

export const LIST_JOBS = (schema: string, appId: string, where: string, limitIdx: number, offsetIdx: number) =>
  `WITH ju_symbols AS (
     SELECT value FROM ${schema}.symbols
     WHERE key LIKE 'keys:%' AND field = 'metadata/ju'
   )
   SELECT j.key, j.entity, j.status, j.is_live, j.created_at,
     CASE WHEN j.updated_at != j.created_at THEN j.updated_at
          WHEN ju.value IS NOT NULL THEN to_timestamp(ju.value, 'YYYYMMDDHH24MISS.MS')
          ELSE j.updated_at
     END as updated_at
   FROM ${schema}.jobs j
   LEFT JOIN ${schema}.jobs_attributes ju
     ON ju.job_id = j.id
     AND ju.symbol IN (SELECT value FROM ju_symbols)
     AND (ju.dimension IS NULL OR ju.dimension = '')
   ${where}
   ORDER BY (CASE WHEN j.status > 0 THEN 0 ELSE 1 END), j.created_at DESC
   LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
