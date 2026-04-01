import { getPool } from '../db';
import { getRegisteredWorkers } from '../workers/registry';
import type { ResolvedHandle } from './types';
import {
  RESOLVE_TASK_BY_WORKFLOW_ID,
  RESOLVE_CONFIG_TASK_QUEUE,
  RESOLVE_JOB_ENTITY,
} from './sql';

/**
 * Resolve a workflowId to the (taskQueue, workflowName) pair that
 * HotMesh needs to get a workflow handle.
 *
 * 1. Look up lt_tasks by workflow_id — returns workflow_type and task_queue.
 * 2. If no task record (e.g., orchestrators/containers), fall back to
 *    durable.jobs (entity) + lt_config_workflows (task_queue).
 * 3. If task_queue is null (pre-migration record), fall back to lt_config_workflows.
 * 4. Throws if the workflow cannot be resolved.
 */
export async function resolveWorkflowHandle(
  workflowId: string,
): Promise<ResolvedHandle> {
  const pool = getPool();

  // 1. Try lt_tasks first (leaf workflows)
  const { rows } = await pool.query(RESOLVE_TASK_BY_WORKFLOW_ID, [workflowId]);

  if (rows.length > 0) {
    const { workflow_type, task_queue } = rows[0];

    if (task_queue) {
      return { taskQueue: task_queue, workflowName: workflow_type };
    }

    // Fallback: resolve task_queue from config (pre-migration records)
    const { rows: configRows } = await pool.query(
      RESOLVE_CONFIG_TASK_QUEUE,
      [workflow_type],
    );

    if (configRows.length > 0 && configRows[0].task_queue) {
      return { taskQueue: configRows[0].task_queue, workflowName: workflow_type };
    }
  }

  // 2. Fall back to durable.jobs — handles orchestrators/containers that
  //    have no lt_tasks record but do have a job with an entity tag.
  const { rows: jobRows } = await pool.query(
    RESOLVE_JOB_ENTITY,
    [`hmsh:durable:j:${workflowId}`],
  );

  if (jobRows.length > 0 && jobRows[0].entity) {
    const entity = jobRows[0].entity;

    // 2a. Try lt_config_workflows for task_queue
    const { rows: configRows } = await pool.query(
      RESOLVE_CONFIG_TASK_QUEUE,
      [entity],
    );

    if (configRows.length > 0 && configRows[0].task_queue) {
      return { taskQueue: configRows[0].task_queue, workflowName: entity };
    }

    // 2b. Fall back to in-memory worker registry (unregistered durable workers)
    const worker = getRegisteredWorkers().get(entity);
    if (worker) {
      return { taskQueue: worker.taskQueue, workflowName: entity };
    }
  }

  throw new Error(
    `Cannot resolve workflow "${workflowId}" — no task record or job entity found`,
  );
}
