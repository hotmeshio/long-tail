import * as configService from '../../services/config';
import { cronRegistry } from '../../services/cron';
import { ltConfig } from '../../modules/ltconfig';
import type { LTApiResult } from '../../types/sdk';

/**
 * List all registered workflow configurations.
 *
 * @returns `{ status: 200, data: { workflows: LTWorkflowConfig[] } }`
 */
export async function listWorkflowConfigs(): Promise<LTApiResult> {
  try {
    const configs = await configService.listWorkflowConfigs();
    return { status: 200, data: { workflows: configs } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Get a single workflow configuration by type.
 *
 * @param input.type — workflow type name (e.g. `"reviewContent"`)
 * @returns `{ status: 200, data: <config> }` or 404
 */
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

/**
 * Create or replace a workflow configuration.
 *
 * Invalidates the config cache and restarts the cron schedule if one
 * is defined. Idempotent — safe to call repeatedly with the same input.
 *
 * @param input.type — workflow type name
 * @param input.invocable — whether the workflow can be started via the API
 * @param input.task_queue — HotMesh task queue
 * @param input.default_role — default escalation role
 * @param input.description — human-readable description
 * @param input.execute_as — service account for proxy invocation
 * @param input.roles — roles that can resolve escalations
 * @param input.invocation_roles — roles that can invoke this workflow
 * @param input.consumes — workflow types whose data this workflow consumes
 * @param input.tool_tags — MCP tool tags for discovery
 * @param input.envelope_schema — JSON Schema for envelope.data validation
 * @param input.resolver_schema — JSON Schema for resolver payload validation
 * @param input.cron_schedule — cron expression for scheduled execution
 * @returns `{ status: 200, data: <saved config> }`
 */
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
    // Validate cron expression before persisting
    if (input.cron_schedule) {
      const { validateCronSchedule } = await import('../../services/cron');
      validateCronSchedule(input.cron_schedule);
    }

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

/**
 * Delete a workflow configuration.
 *
 * Removes the config record and invalidates the cache. Active workers
 * continue running — this only removes the config/interceptor binding.
 *
 * @param input.type — workflow type name
 * @returns `{ status: 200, data: { deleted: true, workflow_type } }` or 404
 */
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
