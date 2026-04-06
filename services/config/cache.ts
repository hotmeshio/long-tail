import type { LTResolvedConfig } from '../../types';
import { listWorkflowConfigs } from './read';

export async function loadAllConfigs(): Promise<Map<string, LTResolvedConfig>> {
  const configs = await listWorkflowConfigs();
  const map = new Map<string, LTResolvedConfig>();

  for (const c of configs) {
    map.set(c.workflow_type, {
      invocable: c.invocable,
      taskQueue: c.task_queue,
      role: c.default_role,
      roles: c.roles,
      invocationRoles: c.invocation_roles,
      consumes: c.consumes,
      toolTags: c.tool_tags || [],
      envelopeSchema: c.envelope_schema ?? null,
      resolverSchema: c.resolver_schema ?? null,
      cronSchedule: c.cron_schedule ?? null,
      executeAs: c.execute_as ?? null,
    });
  }

  return map;
}
