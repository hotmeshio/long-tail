import { getPool } from '../../lib/db';
import type {
  LTWorkflowSetRecord,
  LTWorkflowSetStatus,
  CreateWorkflowSetInput,
  UpdateWorkflowSetInput,
  PlanItem,
} from '../../types/workflow-set';
import {
  CREATE_WORKFLOW_SET,
  GET_WORKFLOW_SET,
  UPDATE_WORKFLOW_SET_PLAN,
  UPDATE_WORKFLOW_SET_STATUS,
  DELETE_WORKFLOW_SET,
  LIST_WORKFLOW_SETS_BASE,
} from './sql';

const DEFAULT_LIMIT = 20;

export async function createWorkflowSet(
  input: CreateWorkflowSetInput,
): Promise<LTWorkflowSetRecord> {
  const pool = getPool();
  const { rows } = await pool.query(CREATE_WORKFLOW_SET, [
    input.name,
    input.description || null,
    input.specification,
    JSON.stringify(input.plan || []),
    input.namespaces || [],
    input.source_workflow_id || null,
  ]);
  return rows[0];
}

export async function getWorkflowSet(
  id: string,
): Promise<LTWorkflowSetRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_WORKFLOW_SET, [id]);
  return rows[0] || null;
}

export async function updateWorkflowSetPlan(
  id: string,
  plan: PlanItem[],
  namespaces: string[],
): Promise<LTWorkflowSetRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(UPDATE_WORKFLOW_SET_PLAN, [
    id,
    JSON.stringify(plan),
    namespaces,
  ]);
  return rows[0] || null;
}

export async function updateWorkflowSetStatus(
  id: string,
  status: LTWorkflowSetStatus,
): Promise<LTWorkflowSetRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(UPDATE_WORKFLOW_SET_STATUS, [id, status]);
  return rows[0] || null;
}

export async function updateWorkflowSetSourceWorkflow(
  id: string,
  sourceWorkflowId: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    'UPDATE lt_workflow_sets SET source_workflow_id = $2 WHERE id = $1',
    [id, sourceWorkflowId],
  );
}

export async function deleteWorkflowSet(id: string): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(DELETE_WORKFLOW_SET, [id]);
  return (rowCount ?? 0) > 0;
}

export async function listWorkflowSets(filters: {
  status?: LTWorkflowSetStatus;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ sets: LTWorkflowSetRecord[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filters.status);
  }

  if (filters.search) {
    conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx})`);
    values.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || DEFAULT_LIMIT;
  const offset = filters.offset || 0;

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM lt_workflow_sets ${where}`, values),
    pool.query(
      `${LIST_WORKFLOW_SETS_BASE} ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    sets: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}
