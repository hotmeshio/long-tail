import { loadToolsFromServers } from '../../shared/tool-loader';
import { toolServerMap, toolDefCache } from './caches';

export async function loadTools(
  tags?: string[],
): Promise<{ toolIds: string[]; inventory: string; strategy: string }> {
  return loadToolsFromServers(tags, { toolServerMap, toolDefCache }, { logPrefix: 'mcpQuery' });
}
