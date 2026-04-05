// SQL templates for mcp-runs queries.
// Schema placeholders (${schema}) are interpolated at call time
// because Postgres does not support parameterized schema names.

export const DISTINCT_ENTITIES = (schema: string) =>
  `SELECT DISTINCT entity FROM ${schema}.jobs WHERE entity IS NOT NULL AND entity != '' ORDER BY entity`;

export const ACTIVE_GRAPH_TOPICS =
  `SELECT DISTINCT graph_topic FROM lt_yaml_workflows WHERE app_id = $1 AND status IN ('active', 'deployed')`;

export const COUNT_JOBS = (schema: string, where: string) =>
  `SELECT COUNT(*) FROM ${schema}.jobs j ${where}`;

export const LIST_JOBS = (schema: string, where: string, limitIdx: number, offsetIdx: number) =>
  `SELECT j.key, j.entity, j.status, j.is_live, j.created_at, j.updated_at
   FROM ${schema}.jobs j
   ${where}
   ORDER BY (CASE WHEN j.status > 0 THEN 0 ELSE 1 END), j.created_at DESC
   LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
