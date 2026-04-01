import { getPool } from '../db';
import type { LTTaskRecord, LTTaskStatus, LTMilestone } from '../../types';
import type { CreateTaskInput, UpdateTaskInput } from './types';
import {
  CREATE_TASK,
  APPEND_MILESTONES,
  GET_TASK,
  GET_TASK_BY_SIGNAL_ID,
  GET_TASK_BY_WORKFLOW_ID,
} from './sql';

export async function createTask(input: CreateTaskInput): Promise<LTTaskRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    CREATE_TASK,
    [
      input.workflow_id,
      input.workflow_type,
      input.lt_type,
      input.task_queue || null,
      input.signal_id,
      input.parent_workflow_id,
      input.origin_id || null,
      input.parent_id || null,
      input.envelope,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.priority || 2,
      input.trace_id || null,
      input.span_id || null,
      input.initiated_by || null,
      input.principal_type || null,
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
    APPEND_MILESTONES,
    [JSON.stringify(milestones), id],
  );
  return rows[0];
}

export async function getTask(id: string): Promise<LTTaskRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_TASK, [id]);
  return rows[0] || null;
}

export async function getTaskBySignalId(signalId: string): Promise<LTTaskRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_TASK_BY_SIGNAL_ID, [signalId]);
  return rows[0] || null;
}

export async function getTaskByWorkflowId(workflowId: string): Promise<LTTaskRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_TASK_BY_WORKFLOW_ID, [workflowId]);
  return rows[0] || null;
}

export async function listTasks(filters: {
  status?: LTTaskStatus;
  lt_type?: string;
  workflow_type?: string;
  workflow_id?: string;
  parent_workflow_id?: string;
  origin_id?: string;
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
  if (filters.parent_workflow_id) {
    conditions.push(`parent_workflow_id = $${idx++}`);
    values.push(filters.parent_workflow_id);
  }
  if (filters.origin_id) {
    conditions.push(`origin_id = $${idx++}`);
    values.push(filters.origin_id);
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
