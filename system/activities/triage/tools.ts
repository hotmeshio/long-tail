import { callTool } from '../../workflows/shared/tool-executor';
import { loadToolsFromServers } from '../../workflows/shared/tool-loader';
import { toolServerMap, yamlWorkflowMap, toolDefCache } from './cache';

/** Base tags always included — triage always needs DB + compiled workflows */
export const BASE_TAGS = ['workflows', 'compiled', 'database'];

export async function loadTriageTools(
  tags?: string[],
): Promise<{ toolIds: string[]; inventory: string; strategy: string }> {
  return loadToolsFromServers(tags, { toolServerMap, toolDefCache }, {
    baseTags: BASE_TAGS,
    logPrefix: 'mcpTriage',
  });
}

export async function callTriageTool(
  qualifiedName: string,
  args: Record<string, any>,
): Promise<any> {
  return callTool(qualifiedName, args, { toolServerMap, yamlWorkflowMap });
}
