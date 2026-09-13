import * as configService from '../../services/config';
import * as userService from '../../services/user';
import { canInvokeWorkflow, hasGlobalInvocationAccess } from '../../services/invocation-access';
import { getRegisteredWorkers, SYSTEM_WORKFLOWS } from '../../services/workers/registry';
import type { LTWorkflowConfig } from '../../types/config';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

export const WORKFLOW_TIERS = {
  DURABLE: 'durable',
  REGISTERED: 'registered',
  CERTIFIED: 'certified',
} as const;
export type WorkflowTier = (typeof WORKFLOW_TIERS)[keyof typeof WORKFLOW_TIERS];

export type InvocableWorkflowEntry = LTWorkflowConfig & { tier: WorkflowTier };

function tierOf(config: LTWorkflowConfig | null): WorkflowTier {
  if (!config) return WORKFLOW_TIERS.DURABLE;
  return config.certified ? WORKFLOW_TIERS.CERTIFIED : WORKFLOW_TIERS.REGISTERED;
}

/** An active worker with no registration row, shaped like a config so one list type serves the page. */
function durableEntry(workflowType: string, taskQueue: string): InvocableWorkflowEntry {
  return {
    workflow_type: workflowType,
    invocable: true,
    certified: false,
    task_queue: taskQueue,
    default_role: 'reviewer',
    description: null,
    roles: [],
    invocation_roles: [],
    consumes: [],
    tool_tags: [],
    envelope_schema: null,
    input_schema: null,
    icon: null,
    resolver_schema: null,
    cron_schedule: null,
    execute_as: null,
    read_safe: false,
    tier: WORKFLOW_TIERS.DURABLE,
  };
}

/**
 * The workflows the caller may invoke, decided by the same predicate the
 * invoke gate runs. Callers with global access also see active durable
 * workers that carry no registration row, as the invoke gate admits them.
 *
 * @returns `{ status: 200, data: { workflows: InvocableWorkflowEntry[] } }`
 */
export async function listInvocableWorkflows(auth: LTApiAuth): Promise<LTApiResult> {
  try {
    const [configs, user] = await Promise.all([
      configService.listWorkflowConfigs(),
      auth.userId ? userService.getUser(auth.userId) : Promise.resolve(null),
    ]);
    const roles = user?.roles ?? [];

    const workflows: InvocableWorkflowEntry[] = configs
      .filter((c) => canInvokeWorkflow(c, roles, auth.role))
      .map((c) => ({ ...c, tier: tierOf(c) }));

    if (hasGlobalInvocationAccess(roles, auth.role)) {
      const registered = new Set(configs.map((c) => c.workflow_type));
      for (const [name, { taskQueue }] of getRegisteredWorkers()) {
        if (registered.has(name) || SYSTEM_WORKFLOWS.has(name)) continue;
        workflows.push(durableEntry(name, taskQueue));
      }
    }

    workflows.sort((a, b) => a.workflow_type.localeCompare(b.workflow_type));
    return { status: 200, data: { workflows } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
