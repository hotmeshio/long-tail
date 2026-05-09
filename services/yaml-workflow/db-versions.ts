/**
 * Version history and cron scheduling DB operations for yaml-workflows.
 *
 * Extracted from db.ts to keep each file under 300 lines.
 */

import { getPool } from '../../lib/db';
import { YAML_VERSION_LIMIT } from '../../modules/defaults';
import type { LTYamlWorkflowRecord, LTYamlWorkflowVersionRecord, ActivityManifestEntry } from '../../types/yaml-workflow';
import {
  CREATE_VERSION_SNAPSHOT as CREATE_VERSION_SNAPSHOT_SQL,
  COUNT_VERSIONS,
  LIST_VERSIONS,
  GET_VERSION_SNAPSHOT,
  MARK_CONTENT_DEPLOYED,
  MARK_APP_ID_CONTENT_DEPLOYED,
  UPDATE_CRON_SCHEDULE,
  CLEAR_CRON_SCHEDULE,
  GET_CRON_SCHEDULED_WORKFLOWS,
} from './sql';

// -- Version history ---------------------------------------------------------

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
  const { rows } = await pool.query(GET_VERSION_SNAPSHOT, [workflowId, version]);
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

// -- Cron scheduling ---------------------------------------------------------

export async function updateCronSchedule(
  id: string,
  cronSchedule: string,
  cronEnvelope: Record<string, unknown> | null,
  executeAs: string | null,
): Promise<LTYamlWorkflowRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(UPDATE_CRON_SCHEDULE, [
    id,
    cronSchedule,
    cronEnvelope ? JSON.stringify(cronEnvelope) : null,
    executeAs,
  ]);
  return rows[0] || null;
}

export async function clearCronSchedule(id: string): Promise<LTYamlWorkflowRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(CLEAR_CRON_SCHEDULE, [id]);
  return rows[0] || null;
}

export async function getCronScheduledWorkflows(): Promise<LTYamlWorkflowRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_CRON_SCHEDULED_WORKFLOWS);
  return rows;
}
