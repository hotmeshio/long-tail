import { getPool } from '../db';
import type {
  LTWorkflowConfig,
} from '../../types';
import {
  GET_WORKFLOW,
  GET_WORKFLOW_ROLES,
  GET_WORKFLOW_INVOCATION_ROLES,
  LIST_ALL_WORKFLOWS,
  LIST_ALL_ROLES,
  LIST_ALL_INVOCATION_ROLES,
} from './sql';

export async function getWorkflowConfig(
  workflowType: string,
): Promise<LTWorkflowConfig | null> {
  const pool = getPool();

  const { rows: wfRows } = await pool.query(GET_WORKFLOW, [workflowType]);
  if (wfRows.length === 0) return null;

  const wf = wfRows[0];

  const [rolesResult, invocationRolesResult] = await Promise.all([
    pool.query(GET_WORKFLOW_ROLES, [workflowType]),
    pool.query(GET_WORKFLOW_INVOCATION_ROLES, [workflowType]),
  ]);

  return {
    workflow_type: wf.workflow_type,


    invocable: wf.invocable,
    task_queue: wf.task_queue,
    default_role: wf.default_role,
    description: wf.description,
    roles: rolesResult.rows.map((r: any) => r.role),
    invocation_roles: invocationRolesResult.rows.map((r: any) => r.role),
    consumes: wf.consumes || [],
    tool_tags: wf.tool_tags || [],
    envelope_schema: wf.envelope_schema ?? null,
    resolver_schema: wf.resolver_schema ?? null,
    cron_schedule: wf.cron_schedule ?? null,
    execute_as: wf.execute_as ?? null,
  };
}

export async function listWorkflowConfigs(): Promise<LTWorkflowConfig[]> {
  const pool = getPool();

  const [wfResult, rolesResult, invocationRolesResult] =
    await Promise.all([
      pool.query(LIST_ALL_WORKFLOWS),
      pool.query(LIST_ALL_ROLES),
      pool.query(LIST_ALL_INVOCATION_ROLES),
    ]);

  // Index sub-entities by workflow_type
  const rolesMap = new Map<string, string[]>();
  for (const r of rolesResult.rows) {
    if (!rolesMap.has(r.workflow_type)) rolesMap.set(r.workflow_type, []);
    rolesMap.get(r.workflow_type)!.push(r.role);
  }

  const invocationRolesMap = new Map<string, string[]>();
  for (const r of invocationRolesResult.rows) {
    if (!invocationRolesMap.has(r.workflow_type)) invocationRolesMap.set(r.workflow_type, []);
    invocationRolesMap.get(r.workflow_type)!.push(r.role);
  }

  return wfResult.rows.map((wf: any) => ({
    workflow_type: wf.workflow_type,


    invocable: wf.invocable,
    task_queue: wf.task_queue,
    default_role: wf.default_role,
    description: wf.description,
    roles: rolesMap.get(wf.workflow_type) || [],
    invocation_roles: invocationRolesMap.get(wf.workflow_type) || [],
    consumes: wf.consumes || [],
    tool_tags: wf.tool_tags || [],
    envelope_schema: wf.envelope_schema ?? null,
    resolver_schema: wf.resolver_schema ?? null,
    cron_schedule: wf.cron_schedule ?? null,
    execute_as: wf.execute_as ?? null,
  }));
}
