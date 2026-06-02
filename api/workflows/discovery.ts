import * as configService from '../../services/config';
import { cronRegistry } from '../../services/cron';
import { getPool } from '../../lib/db';
import { getRegisteredWorkers, SYSTEM_WORKFLOWS } from '../../services/workers/registry';
import { DISTINCT_ENTITIES_DURABLE } from '../../services/pipelines/sql';
import type { LTApiResult } from '../../types/sdk';

/**
 * List active workflow workers with their registration status.
 *
 * @param input.include_system — include system workflows (default: false)
 * @returns `{ status: 200, data: { workers: [{ name, task_queue, registered, system }] } }`
 */
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

/**
 * Discover all known workflow types from workers, history, and config.
 *
 * Merges three sources: active in-memory workers, historical entities
 * from the durable jobs table, and registered workflow configs. Returns
 * a unified list with status flags for each type.
 *
 * @param input.include_system — include system workflows (default: false)
 * @returns `{ status: 200, data: { workflows: [{ workflow_type, task_queue, registered, active, invocable, ... }] } }`
 */
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
        const hasCertification = !!(
          config &&
          ((config.roles?.length ?? 0) > 0 ||
           (config.consumes?.length ?? 0) > 0)
        );
        const tier = !config ? 'durable' : hasCertification ? 'certified' : 'configured';
        return {
          workflow_type: workflowType,
          task_queue: config?.task_queue ?? worker?.taskQueue ?? null,
          tier,
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

/**
 * List all cron-scheduled workflows and their active state.
 *
 * @returns `{ status: 200, data: { schedules: [{ workflow_type, cron_schedule, active, ... }] } }`
 */
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
