import { ltConfig } from '../../../modules/ltconfig';
import type { LTResolvedConfig, LTProviderData } from '../../../types';

/**
 * Get the resolved workflow configuration for a given workflow name.
 *
 * Bridges the deterministic workflow sandbox to the config system.
 * Activities run on the activity worker (outside the sandbox), so
 * they use the {@link ltConfig} singleton which maintains a 5-minute
 * TTL cache — most calls resolve from memory without hitting the DB.
 */
export async function ltGetWorkflowConfig(
  workflowName: string,
): Promise<LTResolvedConfig | null> {
  return ltConfig.getResolvedConfig(workflowName);
}

/**
 * Get provider data for a workflow's consumers by looking up
 * completed sibling tasks that share the same origin_id.
 *
 * Uses the cached config to resolve the consumer list, then
 * queries the DB for matching completed task data.
 */
export async function ltGetProviderData(input: {
  workflowName: string;
  originId: string;
}): Promise<LTProviderData> {
  return ltConfig.getProviderData(input.workflowName, input.originId);
}
