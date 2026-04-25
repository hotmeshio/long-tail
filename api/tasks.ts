import * as taskService from '../services/task';
import * as escalationService from '../services/escalation';
import type { LTApiResult } from '../types/sdk';

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
