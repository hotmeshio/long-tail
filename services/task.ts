import { getPool } from './db';
import type { LTTaskRecord, LTTaskStatus, LTMilestone } from '../types';

export interface ResolvedHandle {
  taskQueue: string;
  workflowName: string;
}

export interface CreateTaskInput {
  workflow_id: string;
  workflow_type: string;
  lt_type: string;
  task_queue?: string;
  modality?: string;
  signal_id: string;
  parent_workflow_id: string;
  origin_id?: string;
  parent_id?: string;
  envelope: string;
  metadata?: Record<string, any>;
  priority?: number;
}

export interface UpdateTaskInput {
  status?: LTTaskStatus;
  completed_at?: Date;
  error?: string;
  milestones?: LTMilestone[];
  data?: string;
}

export async function createTask(input: CreateTaskInput): Promise<LTTaskRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO lt_tasks
       (workflow_id, workflow_type, lt_type, task_queue, modality, signal_id,
        parent_workflow_id, origin_id, parent_id, envelope, metadata, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.workflow_id,
      input.workflow_type,
      input.lt_type,
      input.task_queue || null,
      input.modality || null,
      input.signal_id,
      input.parent_workflow_id,
      input.origin_id || null,
      input.parent_id || null,
      input.envelope,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.priority || 2,
    ],
  );
  return rows[0];
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
): Promise<LTTaskRecord> {
  const pool = getPool();
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (input.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(input.status);
  }
  if (input.completed_at !== undefined) {
    sets.push(`completed_at = $${idx++}`);
    values.push(input.completed_at);
  }
  if (input.error !== undefined) {
    sets.push(`error = $${idx++}`);
    values.push(input.error);
  }
  if (input.data !== undefined) {
    sets.push(`data = $${idx++}`);
    values.push(input.data);
  }
  if (input.milestones !== undefined) {
    sets.push(`milestones = $${idx++}`);
    values.push(JSON.stringify(input.milestones));
  }

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE lt_tasks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0];
}

export async function appendMilestones(
  id: string,
  milestones: LTMilestone[],
): Promise<LTTaskRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE lt_tasks
     SET milestones = milestones || $1::jsonb
     WHERE id = $2
     RETURNING *`,
    [JSON.stringify(milestones), id],
  );
  return rows[0];
}

export async function getTask(id: string): Promise<LTTaskRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM lt_tasks WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getTaskBySignalId(signalId: string): Promise<LTTaskRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_tasks WHERE signal_id = $1',
    [signalId],
  );
  return rows[0] || null;
}

export async function getTaskByWorkflowId(workflowId: string): Promise<LTTaskRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_tasks WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1',
    [workflowId],
  );
  return rows[0] || null;
}

export async function listTasks(filters: {
  status?: LTTaskStatus;
  lt_type?: string;
  workflow_type?: string;
  workflow_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ tasks: LTTaskRecord[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.lt_type) {
    conditions.push(`lt_type = $${idx++}`);
    values.push(filters.lt_type);
  }
  if (filters.workflow_type) {
    conditions.push(`workflow_type = $${idx++}`);
    values.push(filters.workflow_type);
  }
  if (filters.workflow_id) {
    conditions.push(`workflow_id = $${idx++}`);
    values.push(filters.workflow_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM lt_tasks ${where}`, values),
    pool.query(
      `SELECT * FROM lt_tasks ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    tasks: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/**
 * Resolve a workflowId to the (taskQueue, workflowName) pair that
 * HotMesh needs to get a workflow handle.
 *
 * 1. Look up lt_tasks by workflow_id — returns workflow_type and task_queue.
 * 2. If task_queue is null (pre-migration record), fall back to lt_config_workflows.
 * 3. Throws if the workflow cannot be resolved.
 */
export async function resolveWorkflowHandle(
  workflowId: string,
): Promise<ResolvedHandle> {
  const pool = getPool();

  const { rows } = await pool.query(
    'SELECT workflow_type, task_queue FROM lt_tasks WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1',
    [workflowId],
  );

  if (rows.length === 0) {
    throw new Error(`No task found for workflow "${workflowId}"`);
  }

  const { workflow_type, task_queue } = rows[0];

  if (task_queue) {
    return { taskQueue: task_queue, workflowName: workflow_type };
  }

  // Fallback: resolve task_queue from config (pre-migration records)
  const { rows: configRows } = await pool.query(
    'SELECT task_queue FROM lt_config_workflows WHERE workflow_type = $1',
    [workflow_type],
  );

  if (configRows.length > 0 && configRows[0].task_queue) {
    return { taskQueue: configRows[0].task_queue, workflowName: workflow_type };
  }

  throw new Error(
    `Cannot resolve task queue for workflow "${workflowId}" (type="${workflow_type}")`,
  );
}
