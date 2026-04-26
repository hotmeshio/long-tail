import * as taskService from '../services/task';
import * as escalationService from '../services/escalation';
import type { LTApiResult } from '../types/sdk';

/**
 * List tasks with optional filters.
 *
 * Tasks represent workflow executions tracked by the LT interceptor.
 *
 * @param input.status — filter by `pending` or `completed`
 * @param input.lt_type — filter by interceptor classification
 * @param input.workflow_type — filter by workflow function name
 * @param input.workflow_id — filter by HotMesh workflow ID
 * @param input.parent_workflow_id — filter by parent orchestrator ID
 * @param input.origin_id — filter by root process origin ID
 * @param input.limit — max results (default: 50)
 * @param input.offset — pagination offset (default: 0)
 * @returns `{ status: 200, data: { tasks, total } }`
 */
export async function listTasks(input: {
  status?: string;
  lt_type?: string;
  workflow_type?: string;
  workflow_id?: string;
  parent_workflow_id?: string;
  origin_id?: string;
  limit?: number;
  offset?: number;
}): Promise<LTApiResult> {
  try {
    const result = await taskService.listTasks(input as any);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Return aggregate process statistics.
 *
 * @param input.period — time window (`1h`, `24h`, `7d`, `30d`)
 * @returns `{ status: 200, data: <process stats> }`
 */
export async function getProcessStats(input: {
  period?: string;
}): Promise<LTApiResult> {
  try {
    const stats = await taskService.getProcessStats(input.period);
    return { status: 200, data: stats };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * List processes (grouped by origin_id) with optional filters.
 *
 * @param input.limit — max results (default: 50)
 * @param input.offset — pagination offset
 * @param input.workflow_type — filter by workflow type
 * @param input.status — filter by status
 * @param input.search — full-text search across process fields
 * @returns `{ status: 200, data: { processes, total } }`
 */
export async function listProcesses(input: {
  limit?: number;
  offset?: number;
  workflow_type?: string;
  status?: string;
  search?: string;
}): Promise<LTApiResult> {
  try {
    const result = await taskService.listProcesses(input);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Get a single process with all its tasks and escalations.
 *
 * @param input.originId — root process origin ID
 * @returns `{ status: 200, data: { origin_id, tasks, escalations } }`
 */
export async function getProcess(input: {
  originId: string;
}): Promise<LTApiResult> {
  try {
    const [tasks, escalations] = await Promise.all([
      taskService.getProcessTasks(input.originId),
      escalationService.getEscalationsByOriginId(input.originId),
    ]);
    return {
      status: 200,
      data: { origin_id: input.originId, tasks, escalations },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Get a single task by ID.
 *
 * @param input.id — task UUID
 * @returns `{ status: 200, data: <task record> }` or 404
 */
export async function getTask(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const task = await taskService.getTask(input.id);
    if (!task) {
      return { status: 404, error: 'Task not found' };
    }
    return { status: 200, data: task };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
