import { createClient } from '../workers';
import * as exportService from '../services/export';
import * as configService from '../services/config';
import { cronRegistry } from '../services/cron';
import { getPool } from '../lib/db';
import { getRegisteredWorkers, SYSTEM_WORKFLOWS } from '../services/workers/registry';
import { DISTINCT_ENTITIES_DURABLE } from '../services/mcp-runs/sql';
import { resolveWorkflowHandle } from '../services/task';
import {
  invokeWorkflow as invokeWorkflowService,
  checkInvocationRoles,
  InvocationError,
} from '../services/workflow-invocation';
import { ltConfig } from '../modules/ltconfig';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

function isResolveError(err: any): boolean {
  return err?.message?.includes('Cannot resolve workflow');
}

// ── Invocation ──────────────────────────────────────────────────────────────

export async function invokeWorkflow(
  input: {
    type: string;
    data?: Record<string, any>;
    metadata?: Record<string, any>;
    execute_as?: string;
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    await checkInvocationRoles(input.type, auth.userId);

    const result = await invokeWorkflowService({
      workflowType: input.type,
      data: input.data || {},
      metadata: input.metadata,
      executeAs: input.execute_as,
      auth: {
        userId: auth.userId,
      },
    });

    return {
      status: 202,
      data: { workflowId: result.workflowId, message: 'Workflow started' },
    };
  } catch (err: any) {
    const status = err instanceof InvocationError ? err.statusCode : 500;
    return { status, error: err.message };
  }
}

export async function getWorkflowStatus(input: {
  workflowId: string;
}): Promise<LTApiResult> {
  try {
    const resolved = await resolveWorkflowHandle(input.workflowId);

    const client = createClient();
    const handle = await client.workflow.getHandle(
      resolved.taskQueue,
      resolved.workflowName,
      input.workflowId,
    );
    const status = await handle.status();

    return {
      status: 200,
      data: { workflowId: input.workflowId, status },
    };
  } catch (err: any) {
    if (isResolveError(err)) return { status: 404, error: err.message };
    return { status: 500, error: err.message };
  }
}

export async function getWorkflowResult(input: {
  workflowId: string;
}): Promise<LTApiResult> {
  try {
    const resolved = await resolveWorkflowHandle(input.workflowId);

    const client = createClient();
    const handle = await client.workflow.getHandle(
      resolved.taskQueue,
      resolved.workflowName,
      input.workflowId,
    );
    const status = await handle.status();

    if (status !== 0) {
      return {
        status: 202,
        data: { workflowId: input.workflowId, status: 'running' },
      };
    }

    const result = await handle.result();
    return {
      status: 200,
      data: { workflowId: input.workflowId, result },
    };
  } catch (err: any) {
    if (isResolveError(err)) return { status: 404, error: err.message };
    return { status: 500, error: err.message };
  }
}

export async function terminateWorkflow(input: {
  workflowId: string;
}): Promise<LTApiResult> {
  try {
    const resolved = await resolveWorkflowHandle(input.workflowId);

    const client = createClient();
    const handle = await client.workflow.getHandle(
      resolved.taskQueue,
      resolved.workflowName,
      input.workflowId,
    );

    await handle.terminate();

    return {
      status: 200,
      data: { terminated: true, workflowId: input.workflowId },
    };
  } catch (err: any) {
    if (isResolveError(err)) return { status: 404, error: err.message };
    return { status: 500, error: err.message };
  }
}

export async function exportWorkflow(input: {
  workflowId: string;
}): Promise<LTApiResult> {
  try {
    const resolved = await resolveWorkflowHandle(input.workflowId);

    const exported = await exportService.exportWorkflow(
      input.workflowId,
      resolved.taskQueue,
      resolved.workflowName,
    );

    return { status: 200, data: exported };
  } catch (err: any) {
    if (isResolveError(err)) return { status: 404, error: err.message };
    return { status: 500, error: err.message };
  }
}

// ── Discovery ───────────────────────────────────────────────────────────────

export async function listWorkers(input: {
  include_system?: boolean;
}): Promise<LTApiResult> {
  try {
    const activeWorkers = getRegisteredWorkers();
    const configs = await configService.listWorkflowConfigs();
    const registeredTypes = new Set(configs.map((c) => c.workflow_type));

    const workers = [...activeWorkers.entries()]
      .filter(([name]) => input.include_system || !SYSTEM_WORKFLOWS.has(name))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, { taskQueue }]) => ({
        name,
        task_queue: taskQueue,
        registered: registeredTypes.has(name),
        system: SYSTEM_WORKFLOWS.has(name),
      }));

    return { status: 200, data: { workers } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function listDiscoveredWorkflows(input: {
  include_system?: boolean;
}): Promise<LTApiResult> {
  try {
    // 1. Active workers from in-memory registry
    const activeWorkers = getRegisteredWorkers();

    // 2. Historical entities from durable.jobs
    const pool = getPool();
    const { rows: entityRows } = await pool.query<{ entity: string }>(DISTINCT_ENTITIES_DURABLE);
    const historicalEntities = new Set(entityRows.map((r) => r.entity));

    // 3. Registered configs
    const configs = await configService.listWorkflowConfigs();
    const configMap = new Map(configs.map((c) => [c.workflow_type, c]));

    // Build unified set of all workflow types
    const allTypes = new Set<string>();
    for (const [name] of activeWorkers) allTypes.add(name);
    for (const entity of historicalEntities) allTypes.add(entity);
    for (const c of configs) allTypes.add(c.workflow_type);

    const workflows = [...allTypes]
      .filter((t) => input.include_system || !SYSTEM_WORKFLOWS.has(t))
      .sort()
      .map((workflowType) => {
        const config = configMap.get(workflowType);
        const worker = activeWorkers.get(workflowType);
        return {
          workflow_type: workflowType,
          task_queue: config?.task_queue ?? worker?.taskQueue ?? null,
          registered: !!config,
          active: !!worker,
          invocable: config?.invocable ?? !!worker,
          system: SYSTEM_WORKFLOWS.has(workflowType),
          description: config?.description ?? null,
          roles: config?.roles ?? [],
          invocation_roles: config?.invocation_roles ?? [],
          execute_as: config?.execute_as ?? null,
        };
      });

    return { status: 200, data: { workflows } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getCronStatus(): Promise<LTApiResult> {
  try {
    const configs = await configService.listWorkflowConfigs();
    const cronConfigs = configs.filter((c) => c.cron_schedule);
    const activeTypes = cronRegistry.activeWorkflowTypes;

    const schedules = cronConfigs.map((c) => ({
      workflow_type: c.workflow_type,
      cron_schedule: c.cron_schedule,
      description: c.description,
      task_queue: c.task_queue,
      invocable: c.invocable,
      active: activeTypes.includes(c.workflow_type),
      envelope_schema: c.envelope_schema,
    }));

    return { status: 200, data: { schedules } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// ── Configuration ───────────────────────────────────────────────────────────

export async function listWorkflowConfigs(): Promise<LTApiResult> {
  try {
    const configs = await configService.listWorkflowConfigs();
    return { status: 200, data: { workflows: configs } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getWorkflowConfig(input: {
  type: string;
}): Promise<LTApiResult> {
  try {
    const config = await configService.getWorkflowConfig(input.type);
    if (!config) {
      return { status: 404, error: 'Workflow config not found' };
    }
    return { status: 200, data: config };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function upsertWorkflowConfig(input: {
  type: string;
  invocable?: boolean;
  task_queue?: string | null;
  default_role?: string;
  description?: string | null;
  execute_as?: string | null;
  roles?: string[];
  invocation_roles?: string[];
  consumes?: string[];
  tool_tags?: string[];
  envelope_schema?: any;
  resolver_schema?: any;
  cron_schedule?: string | null;
}): Promise<LTApiResult> {
  try {
    const config = await configService.upsertWorkflowConfig({
      workflow_type: input.type,
      invocable: input.invocable ?? false,
      task_queue: input.task_queue ?? null,
      default_role: input.default_role ?? 'reviewer',
      description: input.description ?? null,
      execute_as: input.execute_as ?? null,
      roles: input.roles ?? [],
      invocation_roles: input.invocation_roles ?? [],
      consumes: input.consumes ?? [],
      tool_tags: input.tool_tags ?? [],
      envelope_schema: input.envelope_schema ?? null,
      resolver_schema: input.resolver_schema ?? null,
      cron_schedule: input.cron_schedule ?? null,
    });
    ltConfig.invalidate();
    await cronRegistry.restartCron(config);
    return { status: 200, data: config };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function deleteWorkflowConfig(input: {
  type: string;
}): Promise<LTApiResult> {
  try {
    const deleted = await configService.deleteWorkflowConfig(input.type);
    if (!deleted) {
      return { status: 404, error: 'Workflow config not found' };
    }
    ltConfig.invalidate();
    return { status: 200, data: { deleted: true, workflow_type: input.type } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
