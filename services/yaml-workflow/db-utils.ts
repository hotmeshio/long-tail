import { getPool } from '../../lib/db';
import { YAML_LIST_LIMIT } from '../../modules/defaults';
import type { LTYamlWorkflowRecord, LTYamlWorkflowStatus } from '../../types/yaml-workflow';
import {
  UPDATE_STATUS_BASE,
  UPDATE_STATUS_SUFFIX,
  FIND_BY_TAGS_ANY,
  FIND_BY_TAGS_ALL,
} from './sql';

/**
 * Extract the `app.version` value from YAML content using a simple regex.
 * Returns null if not found.
 */
export function parseVersionFromYaml(yaml: string): string | null {
  const match = yaml.match(/^app:\s*\n(?:.*\n)*?\s+version:\s*['"]?(\S+?)['"]?\s*$/m);
  if (match) return match[1];
  const lines = yaml.split('\n');
  let inApp = false;
  for (const line of lines) {
    if (/^app:\s*$/.test(line)) { inApp = true; continue; }
    if (inApp && /^\S/.test(line)) break;
    if (inApp) {
      const vm = line.match(/^\s+version:\s*['"]?(.+?)['"]?\s*$/);
      if (vm) return vm[1];
    }
  }
  return null;
}

export async function updateYamlWorkflowStatus(
  id: string,
  status: LTYamlWorkflowStatus,
): Promise<LTYamlWorkflowRecord | null> {
  const pool = getPool();
  const timestampField =
    status === 'deployed' ? ', deployed_at = NOW()' :
    status === 'active' ? ', activated_at = NOW()' : '';

  const { rows } = await pool.query(
    `${UPDATE_STATUS_BASE}${timestampField}${UPDATE_STATUS_SUFFIX}`,
    [id, status],
  );
  return rows[0] || null;
}

export async function listYamlWorkflows(filters: {
  status?: LTYamlWorkflowStatus;
  graph_topic?: string;
  app_id?: string;
  tags?: string[];
  search?: string;
  source_workflow_id?: string;
  set_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ workflows: LTYamlWorkflowRecord[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filters.status);
  }

  if (filters.graph_topic) {
    conditions.push(`graph_topic = $${idx++}`);
    values.push(filters.graph_topic);
  }

  if (filters.app_id) {
    conditions.push(`app_id = $${idx++}`);
    values.push(filters.app_id);
  }

  if (filters.tags?.length) {
    conditions.push(`tags && $${idx++}::text[]`);
    values.push(filters.tags);
  }

  if (filters.search) {
    conditions.push(`(name ILIKE $${idx} OR graph_topic ILIKE $${idx} OR description ILIKE $${idx} OR app_id ILIKE $${idx})`);
    values.push(`%${filters.search}%`);
    idx++;
  }

  if (filters.source_workflow_id) {
    conditions.push(`source_workflow_id = $${idx++}`);
    values.push(filters.source_workflow_id);
  }

  if (filters.set_id) {
    conditions.push(`set_id = $${idx++}`);
    values.push(filters.set_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || YAML_LIST_LIMIT;
  const offset = filters.offset || 0;

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM lt_yaml_workflows ${where}`, values),
    pool.query(
      `SELECT * FROM lt_yaml_workflows ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    workflows: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/**
 * Find active YAML workflows matching any of the given tags.
 * Uses GIN index on tags column for efficient lookup.
 */
export async function findYamlWorkflowsByTags(
  tags: string[],
  match: 'any' | 'all' = 'any',
): Promise<LTYamlWorkflowRecord[]> {
  const pool = getPool();
  const sql = match === 'all' ? FIND_BY_TAGS_ALL : FIND_BY_TAGS_ANY;
  const { rows } = await pool.query(sql, [tags]);
  return rows;
}
