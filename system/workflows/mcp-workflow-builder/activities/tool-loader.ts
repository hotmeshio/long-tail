import { loadToolsFromServers } from '../../shared/tool-loader';
import { toolServerMap, toolDefCache } from './caches';

export async function loadBuilderTools(
  tags?: string[],
): Promise<{ toolIds: string[]; inventory: string; strategy: string }> {
  return loadToolsFromServers(tags, { toolServerMap, toolDefCache }, { logPrefix: 'workflowBuilder' });
}
