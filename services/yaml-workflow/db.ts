import { getPool } from '../../lib/db';
import type { LTYamlWorkflowRecord } from '../../types/yaml-workflow';
import {
  CREATE_YAML_WORKFLOW,
  CHECK_TOPIC_UNIQUE,
  GET_YAML_WORKFLOW,
  GET_YAML_WORKFLOW_BY_NAME,
  UPDATE_YAML_WORKFLOW_VERSION,
  DELETE_YAML_WORKFLOW,
  GET_ACTIVE_YAML_WORKFLOWS,
  LIST_BY_APP_ID,
  GET_DISTINCT_APP_IDS,
  GET_MAX_APP_VERSION,
  DISCOVER_WORKFLOWS,
} from './sql';
import type { CreateYamlWorkflowInput } from './types';
import { parseVersionFromYaml } from './db-utils';
import { createVersionSnapshot } from './db-versions';

// Re-export functions from db-utils
export {
  parseVersionFromYaml,
  updateYamlWorkflowStatus,
  listYamlWorkflows,
  findYamlWorkflowsByTags,
} from './db-utils';

// Re-export version history and cron scheduling from db-versions
export {
  createVersionSnapshot,
  getVersionHistory,
  getVersionSnapshot,
  markContentDeployed,
  markAppIdContentDeployed,
  updateCronSchedule,
  clearCronSchedule,
  getCronScheduledWorkflows,
} from './db-versions';

/**
 * Check whether a graph_topic is already in use by a non-archived workflow
 * in the same namespace. Returns the conflicting workflow name, or null.
 */
export async function checkTopicConflict(
  appId: string,
  graphTopic: string,
  excludeId?: string,
): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query(CHECK_TOPIC_UNIQUE, [appId, graphTopic]);
  if (rows.length === 0) return null;
  if (excludeId && rows[0].id === excludeId) return null;
  return rows[0].name;
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
      input.set_id || null,
      input.set_role || null,
      input.set_build_order ?? null,
    ],
  );
  const record = rows[0];

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
  const { rows } = await pool.query(GET_YAML_WORKFLOW_BY_NAME, [name]);
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

/**
 * Ranked discovery: find active workflows matching the user's prompt
 * via full-text search (tsvector) + tag overlap + optional category filter.
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

export async function getActiveYamlWorkflows(): Promise<LTYamlWorkflowRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ACTIVE_YAML_WORKFLOWS);
  return rows;
}

export async function listYamlWorkflowsByAppId(appId: string): Promise<LTYamlWorkflowRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(LIST_BY_APP_ID, [appId]);
  return rows;
}

/**
 * Return the next app-level version for a namespace.
 *
 * Each deploy of an app (namespace) must use a strictly increasing integer
 * version. This queries the current max across all non-archived workflows
 * in the namespace and returns max + 1.
 *
 * A new namespace with no workflows returns '1'.
 * An existing namespace with one active tool at v1 returns '2' when a
 * second tool is added -- even though that second tool is "version 1" of itself.
 */
export async function getNextAppVersion(appId: string): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query(GET_MAX_APP_VERSION, [appId]);
  const max = parseInt(rows[0]?.max_version ?? '0', 10);
  return String(max + 1);
}

export async function getDistinctAppIds(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_DISTINCT_APP_IDS);
  return rows.map((r: { app_id: string }) => r.app_id);
}
