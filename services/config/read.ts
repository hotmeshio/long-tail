import { getPool } from '../db';
import type {
  LTWorkflowConfig,
  LTLifecycleHook,
} from '../../types';
import {
  GET_WORKFLOW,
  GET_WORKFLOW_ROLES,
  GET_WORKFLOW_INVOCATION_ROLES,
  GET_WORKFLOW_LIFECYCLE,
  LIST_ALL_WORKFLOWS,
  LIST_ALL_ROLES,
  LIST_ALL_INVOCATION_ROLES,
  LIST_ALL_LIFECYCLE,
} from './sql';

export async function getWorkflowConfig(
  workflowType: string,
): Promise<LTWorkflowConfig | null> {
  const pool = getPool();

  const { rows: wfRows } = await pool.query(GET_WORKFLOW, [workflowType]);
  if (wfRows.length === 0) return null;

  const wf = wfRows[0];

  const [rolesResult, invocationRolesResult, lifecycleResult] = await Promise.all([
    pool.query(GET_WORKFLOW_ROLES, [workflowType]),
    pool.query(GET_WORKFLOW_INVOCATION_ROLES, [workflowType]),
    pool.query(GET_WORKFLOW_LIFECYCLE, [workflowType]),
  ]);

  const onBefore: LTLifecycleHook[] = [];
  const onAfter: LTLifecycleHook[] = [];
  for (const row of lifecycleResult.rows) {
    const hook: LTLifecycleHook = {
      target_workflow_type: row.target_workflow_type,
      target_task_queue: row.target_task_queue,
      ordinal: row.ordinal,
    };
    if (row.hook === 'onBefore') onBefore.push(hook);
    else onAfter.push(hook);
  }

  return {
    workflow_type: wf.workflow_type,
    is_lt: wf.is_lt,
    is_container: wf.is_container,
    invocable: wf.invocable,
    task_queue: wf.task_queue,
    default_role: wf.default_role,
    default_modality: wf.default_modality,
    description: wf.description,
    roles: rolesResult.rows.map((r: any) => r.role),
    invocation_roles: invocationRolesResult.rows.map((r: any) => r.role),
    lifecycle: { onBefore, onAfter },
    consumes: wf.consumes || [],
    envelope_schema: wf.envelope_schema ?? null,
    resolver_schema: wf.resolver_schema ?? null,
    cron_schedule: wf.cron_schedule ?? null,
  };
}

export async function listWorkflowConfigs(): Promise<LTWorkflowConfig[]> {
  const pool = getPool();

  const [wfResult, rolesResult, invocationRolesResult, lifecycleResult] =
    await Promise.all([
      pool.query(LIST_ALL_WORKFLOWS),
      pool.query(LIST_ALL_ROLES),
      pool.query(LIST_ALL_INVOCATION_ROLES),
      pool.query(LIST_ALL_LIFECYCLE),
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

  const lifecycleMap = new Map<
    string,
    { onBefore: LTLifecycleHook[]; onAfter: LTLifecycleHook[] }
  >();
  for (const r of lifecycleResult.rows) {
    if (!lifecycleMap.has(r.workflow_type)) {
      lifecycleMap.set(r.workflow_type, { onBefore: [], onAfter: [] });
    }
    const hook: LTLifecycleHook = {
      target_workflow_type: r.target_workflow_type,
      target_task_queue: r.target_task_queue,
      ordinal: r.ordinal,
    };
    if (r.hook === 'onBefore') {
      lifecycleMap.get(r.workflow_type)!.onBefore.push(hook);
    } else {
      lifecycleMap.get(r.workflow_type)!.onAfter.push(hook);
    }
  }

  return wfResult.rows.map((wf: any) => ({
    workflow_type: wf.workflow_type,
    is_lt: wf.is_lt,
    is_container: wf.is_container,
    invocable: wf.invocable,
    task_queue: wf.task_queue,
    default_role: wf.default_role,
    default_modality: wf.default_modality,
    description: wf.description,
    roles: rolesMap.get(wf.workflow_type) || [],
    invocation_roles: invocationRolesMap.get(wf.workflow_type) || [],
    lifecycle: lifecycleMap.get(wf.workflow_type) || {
      onBefore: [],
      onAfter: [],
    },
    consumes: wf.consumes || [],
    envelope_schema: wf.envelope_schema ?? null,
    resolver_schema: wf.resolver_schema ?? null,
    cron_schedule: wf.cron_schedule ?? null,
  }));
}
