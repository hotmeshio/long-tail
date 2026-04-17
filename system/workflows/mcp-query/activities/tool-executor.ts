import { callTool } from '../../shared/tool-executor';
import { toolServerMap, yamlWorkflowMap } from './caches';

export async function callMcpTool(
  qualifiedName: string,
  args: Record<string, any>,
): Promise<any> {
  return callTool(qualifiedName, args, { toolServerMap, yamlWorkflowMap });
}
