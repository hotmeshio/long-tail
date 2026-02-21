import * as configService from '../../services/config';
import type { LTResolvedConfig, LTConsumerConfig, LTProviderData } from '../../types';

/**
 * Get the resolved workflow configuration from the database.
 * Bridges the deterministic workflow sandbox to the config cache.
 */
export async function ltGetWorkflowConfig(
  workflowName: string,
): Promise<LTResolvedConfig | null> {
  const configs = await configService.loadAllConfigs();
  return configs.get(workflowName) ?? null;
}

/**
 * Get provider data for a workflow's consumers by looking up
 * completed sibling tasks that share the same origin_id.
 */
export async function ltGetProviderData(input: {
  consumers: LTConsumerConfig[];
  originId: string;
}): Promise<LTProviderData> {
  return configService.getProviderData(input.consumers, input.originId);
}
