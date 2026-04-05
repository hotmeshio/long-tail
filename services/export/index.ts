import type {
  ExecutionExportOptions,
  WorkflowExecution,
  ActivityDetail,
} from '@hotmeshio/hotmesh/build/types/exporter';

import type {
  LTExportOptions,
  LTWorkflowExport,
  LTTimelineEntry,
  LTTransitionEntry,
} from '../../types';
import { getPool } from '../db';

import { getHandle } from './client';
import { postProcessExecution } from './post-process';
import type { JobListParams, JobListResult, JobRow } from './types';

/** Error thrown when a workflow job is not found (expired or never existed). */
class WorkflowNotFoundError extends Error {
  status = 404;
  constructor(workflowId: string) {
    super(`${workflowId} Not Found`);
    this.name = 'WorkflowNotFoundError';
  }
}

/**
 * Export the full workflow state for a given workflow (raw HotMesh format).
 *
 * Delegates to the HotMesh Durable `handle.export()` method and
 * normalises the result into an `LTWorkflowExport`.
 */
export async function exportWorkflow(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
  options?: LTExportOptions,
): Promise<LTWorkflowExport> {
  try {
    const handle = await getHandle(taskQueue, workflowName, workflowId);
    const raw = await handle.export({ ...options, enrich_inputs: true });

    return {
      workflow_id: workflowId,
      data: raw.data,
      state: raw.state,
      status: raw.status,
      timeline: raw.timeline as LTTimelineEntry[] | undefined,
      transitions: raw.transitions as LTTransitionEntry[] | undefined,
    };
  } catch (err: any) {
    if (err instanceof WorkflowNotFoundError) throw err;
    throw new WorkflowNotFoundError(workflowId);
  }
}

/**
 * Return only the status semaphore for a workflow.
 * 0 = complete, negative = interrupted.
 */
export async function getWorkflowStatus(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
): Promise<{ workflow_id: string; status: number }> {
  try {
    const handle = await getHandle(taskQueue, workflowName, workflowId);
    const status = await handle.status();
    return { workflow_id: workflowId, status };
  } catch {
    throw new WorkflowNotFoundError(workflowId);
  }
}

/**
 * Export workflow state as a structured execution event history.
 *
 * Delegates to HotMesh's native `handle.exportExecution()` which produces
 * typed events with ISO timestamps, durations, event cross-references,
 * system/user classification, and a summary.
 */
export async function exportWorkflowExecution(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
  options?: ExecutionExportOptions,
): Promise<WorkflowExecution> {
  try {
    const handle = await getHandle(taskQueue, workflowName, workflowId);
    const execution = await handle.exportExecution({ ...options, enrich_inputs: true });
    return postProcessExecution(execution);
  } catch (err: any) {
    if (err instanceof WorkflowNotFoundError) throw err;
    throw new WorkflowNotFoundError(workflowId);
  }
}

/**
 * Return the current job state of a workflow.
 * If the workflow is complete this is also the output.
 */
export async function getWorkflowState(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
): Promise<{ workflow_id: string; state: Record<string, any> }> {
  try {
    const handle = await getHandle(taskQueue, workflowName, workflowId);
    const state = await handle.state(true);
    return { workflow_id: workflowId, state };
  } catch {
    throw new WorkflowNotFoundError(workflowId);
  }
}

const JOB_SORTABLE_COLUMNS = new Set(['created_at', 'updated_at', 'entity', 'status']);

function buildJobOrderBy(sortBy?: string, order?: string): string {
  if (!sortBy || !JOB_SORTABLE_COLUMNS.has(sortBy)) {
    return '(CASE WHEN j.status > 0 THEN 0 ELSE 1 END), j.created_at DESC';
  }
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  return `j.${sortBy} ${dir}`;
}

/**
 * List workflow jobs from durable.jobs where entity IS NOT NULL.
 * Returns paginated results sorted by active first, then created_at DESC.
 */
export async function listJobs(params: JobListParams): Promise<JobListResult> {
  const limit = Math.min(params.limit ?? 20, 100);
  const offset = params.offset ?? 0;

  const pool = getPool();
  const conditions = ['j.entity IS NOT NULL'];
  const values: any[] = [];
  let idx = 1;

  if (params.registered === 'true') {
    conditions.push(
      `EXISTS (SELECT 1 FROM lt_config_workflows c WHERE c.workflow_type = j.entity)`,
    );
  } else if (params.registered === 'false') {
    conditions.push(
      `NOT EXISTS (SELECT 1 FROM lt_config_workflows c WHERE c.workflow_type = j.entity)`,
    );
  }

  if (params.entity) {
    const entities = params.entity.split(',').map((e) => e.trim()).filter(Boolean);
    if (entities.length === 1) {
      conditions.push(`j.entity = $${idx++}`);
      values.push(entities[0]);
    } else if (entities.length > 1) {
      conditions.push(`j.entity = ANY($${idx++})`);
      values.push(entities);
    }
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

  const where = conditions.join(' AND ');

  const [countResult, dataResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FROM durable.jobs j WHERE ${where}`,
      values,
    ),
    pool.query(
      `SELECT j.key, j.entity, j.status, j.is_live, j.created_at, j.updated_at
       FROM durable.jobs j
       WHERE ${where}
       ORDER BY ${buildJobOrderBy(params.sort_by, params.order)}
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
  ]);

  const jobs = dataResult.rows.map((row: any) => ({
    workflow_id: row.key.replace('hmsh:durable:j:', ''),
    entity: row.entity,
    status: (row.status > 0 ? 'running' : row.status === 0 ? 'completed' : 'failed') as JobRow['status'],
    is_live: row.is_live,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return { jobs, total: parseInt(countResult.rows[0].count, 10) };
}
