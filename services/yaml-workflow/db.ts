import { getPool } from '../db';
import { YAML_LIST_LIMIT, YAML_VERSION_LIMIT } from '../../modules/defaults';
import type { LTYamlWorkflowRecord, LTYamlWorkflowStatus, LTYamlWorkflowVersionRecord, ActivityManifestEntry } from '../../types/yaml-workflow';
import {
  CREATE_YAML_WORKFLOW,
  GET_YAML_WORKFLOW,
  GET_YAML_WORKFLOW_BY_NAME,
  UPDATE_YAML_WORKFLOW_VERSION,
  DELETE_YAML_WORKFLOW,
  GET_ACTIVE_YAML_WORKFLOWS,
  LIST_BY_APP_ID,
  GET_DISTINCT_APP_IDS,
  MARK_CONTENT_DEPLOYED,
  MARK_APP_ID_CONTENT_DEPLOYED,
  CREATE_VERSION_SNAPSHOT as CREATE_VERSION_SNAPSHOT_SQL,
  COUNT_VERSIONS,
  LIST_VERSIONS,
  GET_VERSION_SNAPSHOT,
  DISCOVER_WORKFLOWS,
} from './sql';

export interface CreateYamlWorkflowInput {
  name: string;
  description?: string;
  app_id: string;
  app_version?: string;
  source_workflow_id?: string;
  source_workflow_type?: string;
  yaml_content: string;
  graph_topic: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  activity_manifest?: ActivityManifestEntry[];
  input_field_meta?: import('../../types/yaml-workflow').InputFieldMeta[];
  original_prompt?: string;
  category?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Extract the `app.version` value from YAML content using a simple regex.
 * Returns null if not found.
 */
export function parseVersionFromYaml(yaml: string): string | null {
  const match = yaml.match(/^app:\s*\n(?:.*\n)*?\s+version:\s*['"]?(\S+?)['"]?\s*$/m);
  if (match) return match[1];
  // Fallback: look for version anywhere under app block
  const lines = yaml.split('\n');
  let inApp = false;
  for (const line of lines) {
    if (/^app:\s*$/.test(line)) { inApp = true; continue; }
    if (inApp && /^\S/.test(line)) break; // left app block
    if (inApp) {
      const vm = line.match(/^\s+version:\s*['"]?(.+?)['"]?\s*$/);
      if (vm) return vm[1];
    }
  }
  return null;
}

export async function createYamlWorkflow(
  input: CreateYamlWorkflowInput,
): Promise<LTYamlWorkflowRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    CREATE_YAML_WORKFLOW,
    [
      input.name,
      input.description || null,
      input.app_id,
      input.app_version || parseVersionFromYaml(input.yaml_content) || '0',
      input.source_workflow_id || null,
      input.source_workflow_type || null,
      input.yaml_content,
      input.graph_topic,
      JSON.stringify(input.input_schema || {}),
      JSON.stringify(input.output_schema || {}),
      JSON.stringify(input.activity_manifest || []),
      JSON.stringify(input.input_field_meta || []),
      input.original_prompt || null,
      input.category || null,
      input.tags || [],
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  const record = rows[0];

  // Seed initial version snapshot
  await createVersionSnapshot(record.id, 1, record.yaml_content,
    input.activity_manifest || [], input.input_schema || {}, input.output_schema || {},
    input.input_field_meta || [], 'Initial version');

  return record;
}

export async function getYamlWorkflow(id: string): Promise<LTYamlWorkflowRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_YAML_WORKFLOW, [id]);
  return rows[0] || null;
}

export async function getYamlWorkflowByName(name: string): Promise<LTYamlWorkflowRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_YAML_WORKFLOW_BY_NAME, [name],
  );
  return rows[0] || null;
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
    `UPDATE lt_yaml_workflows SET status = $2${timestampField} WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] || null;
}

export async function updateYamlWorkflowVersion(
  id: string,
  version: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(UPDATE_YAML_WORKFLOW_VERSION, [id, version]);
}

export async function updateYamlWorkflow(
  id: string,
  updates: Partial<Pick<CreateYamlWorkflowInput, 'name' | 'description' | 'app_id' | 'yaml_content' | 'graph_topic' | 'input_schema' | 'output_schema' | 'activity_manifest' | 'tags' | 'metadata'>>,
): Promise<LTYamlWorkflowRecord | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const yamlChanging = updates.yaml_content !== undefined;

  if (updates.name !== undefined) { sets.push(`name = $${idx++}`); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push(`description = $${idx++}`); values.push(updates.description); }
  if (updates.app_id !== undefined) { sets.push(`app_id = $${idx++}`); values.push(updates.app_id); }
  if (updates.yaml_content !== undefined) { sets.push(`yaml_content = $${idx++}`); values.push(updates.yaml_content); }
  if (updates.graph_topic !== undefined) { sets.push(`graph_topic = $${idx++}`); values.push(updates.graph_topic); }
  if (updates.input_schema !== undefined) { sets.push(`input_schema = $${idx++}`); values.push(JSON.stringify(updates.input_schema)); }
  if (updates.output_schema !== undefined) { sets.push(`output_schema = $${idx++}`); values.push(JSON.stringify(updates.output_schema)); }
  if (updates.activity_manifest !== undefined) { sets.push(`activity_manifest = $${idx++}`); values.push(JSON.stringify(updates.activity_manifest)); }
  if (updates.tags !== undefined) { sets.push(`tags = $${idx++}`); values.push(updates.tags); }
  if (updates.metadata !== undefined) { sets.push(`metadata = $${idx++}`); values.push(JSON.stringify(updates.metadata)); }

  // When YAML content changes, bump the content_version and sync app_version from YAML
  if (yamlChanging) {
    sets.push(`content_version = content_version + 1`);
    const parsedVersion = parseVersionFromYaml(updates.yaml_content!);
    if (parsedVersion) {
      sets.push(`app_version = $${idx++}`);
      values.push(parsedVersion);
    }
  }

  if (sets.length === 0) return getYamlWorkflow(id);

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE lt_yaml_workflows SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  const record = rows[0] || null;

  // Create a version snapshot when YAML content changes
  if (record && yamlChanging) {
    await createVersionSnapshot(
      record.id,
      record.content_version,
      record.yaml_content,
      record.activity_manifest,
      record.input_schema,
      record.output_schema,
      record.input_field_meta,
    );
  }

  return record;
}

export async function deleteYamlWorkflow(id: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_YAML_WORKFLOW, [id]);
  return (rowCount || 0) > 0;
}

export async function listYamlWorkflows(filters: {
  status?: LTYamlWorkflowStatus;
  graph_topic?: string;
  app_id?: string;
  tags?: string[];
  search?: string;
  source_workflow_id?: string;
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
 * Ranked discovery: find active workflows matching the user's prompt
 * via full-text search (tsvector) + tag overlap + optional category filter.
 * Returns results ordered by relevance score.
 */
export async function discoverWorkflows(
  prompt: string,
  tags: string[],
  category?: string | null,
  limit = 5,
): Promise<(LTYamlWorkflowRecord & { fts_rank: number })[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    DISCOVER_WORKFLOWS,
    [prompt, tags, category || null, limit],
  );
  return rows;
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
  const operator = match === 'all' ? '@>' : '&&';
  const { rows } = await pool.query(
    `SELECT * FROM lt_yaml_workflows
     WHERE status = 'active' AND tags ${operator} $1::text[]
     ORDER BY name`,
    [tags],
  );
  return rows;
}

export async function getActiveYamlWorkflows(): Promise<LTYamlWorkflowRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ACTIVE_YAML_WORKFLOWS);
  return rows;
}

export async function listYamlWorkflowsByAppId(appId: string): Promise<LTYamlWorkflowRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(LIST_BY_APP_ID, [appId],
  );
  return rows;
}

export async function getDistinctAppIds(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_DISTINCT_APP_IDS);
  return rows.map((r: { app_id: string }) => r.app_id);
}

// ── Version history ────────────────────────────────────────────

export async function createVersionSnapshot(
  workflowId: string,
  version: number,
  yamlContent: string,
  activityManifest: ActivityManifestEntry[] | unknown,
  inputSchema: Record<string, unknown> | unknown,
  outputSchema: Record<string, unknown> | unknown,
  inputFieldMeta?: unknown,
  changeSummary?: string,
): Promise<LTYamlWorkflowVersionRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    CREATE_VERSION_SNAPSHOT_SQL,
    [
      workflowId, version, yamlContent,
      JSON.stringify(activityManifest),
      JSON.stringify(inputSchema),
      JSON.stringify(outputSchema),
      JSON.stringify(inputFieldMeta || []),
      changeSummary || null,
    ],
  );
  return rows[0];
}

export async function getVersionHistory(
  workflowId: string,
  limit = YAML_VERSION_LIMIT,
  offset = 0,
): Promise<{ versions: LTYamlWorkflowVersionRecord[]; total: number }> {
  const pool = getPool();
  const [countResult, dataResult] = await Promise.all([
    pool.query(COUNT_VERSIONS, [workflowId]),
    pool.query(LIST_VERSIONS, [workflowId, limit, offset]),
  ]);
  return {
    versions: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function getVersionSnapshot(
  workflowId: string,
  version: number,
): Promise<LTYamlWorkflowVersionRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_VERSION_SNAPSHOT, [workflowId, version],
  );
  return rows[0] || null;
}

export async function markContentDeployed(workflowId: string): Promise<void> {
  const pool = getPool();
  await pool.query(MARK_CONTENT_DEPLOYED, [workflowId]);
}

export async function markAppIdContentDeployed(appId: string): Promise<void> {
  const pool = getPool();
  await pool.query(MARK_APP_ID_CONTENT_DEPLOYED, [appId]);
}
