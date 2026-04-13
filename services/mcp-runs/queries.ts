import { getPool } from '../db';
import { sanitizeAppId, quoteSchema } from '../hotmesh-utils';

import { DISTINCT_ENTITIES, ACTIVE_GRAPH_TOPICS, COUNT_JOBS, LIST_JOBS } from './sql';

export interface ListJobsParams {
  rawAppId: string;
  limit?: number;
  offset?: number;
  entity?: string;
  search?: string;
  status?: string;
}

interface JobRow {
  workflow_id: string;
  entity: string;
  status: string;
  is_live: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Return distinct entity names from job runs + yaml workflow graph_topics.
 */
export async function listEntities(rawAppId: string): Promise<string[]> {
  const appId = sanitizeAppId(rawAppId);
  const schema = quoteSchema(appId);
  const pool = getPool();

  const [jobResult, yamlResult] = await Promise.all([
    pool.query(DISTINCT_ENTITIES(schema)).catch(() => ({ rows: [] as any[] })),
    pool.query(ACTIVE_GRAPH_TOPICS, [rawAppId]).catch(() => ({ rows: [] as any[] })),
  ]);

  const entitySet = new Set<string>();
  for (const r of jobResult.rows) entitySet.add(r.entity);
  for (const r of yamlResult.rows) entitySet.add(r.graph_topic);

  return [...entitySet].sort();
}

/**
 * List jobs with filtering, pagination, and status mapping.
 */
export async function listJobs(params: ListJobsParams): Promise<{ jobs: JobRow[]; total: number }> {
  const { rawAppId } = params;
  const appId = sanitizeAppId(rawAppId);
  const schema = quoteSchema(appId);
  const limit = Math.min(params.limit ?? 20, 100);
  const offset = params.offset ?? 0;
  const pool = getPool();

  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (params.entity) {
    conditions.push(`j.entity = $${idx++}`);
    values.push(params.entity);
  }
  if (params.search) {
    conditions.push(`j.key ILIKE $${idx++}`);
    values.push(`%${params.search}%`);
  }
  if (params.status === 'running') {
    conditions.push('j.status > 0');
  } else if (params.status === 'completed') {
    conditions.push('j.status = 0');
  } else if (params.status === 'failed') {
    conditions.push('j.status < 0');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const keyPrefix = `hmsh:${appId}:j:`;

  const [countResult, dataResult] = await Promise.all([
    pool.query(COUNT_JOBS(schema, where), values),
    pool.query(LIST_JOBS(schema, appId, where, idx++, idx++), [...values, limit, offset]),
  ]);

  const jobs = dataResult.rows.map((row: any) => ({
    workflow_id: row.key.startsWith(keyPrefix) ? row.key.slice(keyPrefix.length) : row.key,
    entity: row.entity,
    status: row.status > 0 ? 'running' : row.status === 0 ? 'completed' : 'failed',
    is_live: row.is_live,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return { jobs, total: parseInt(countResult.rows[0].count, 10) };
}
