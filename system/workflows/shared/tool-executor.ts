import { getToolContext } from '../../../services/iam/context';
import { exchangeTokensInArgs } from '../../../services/iam/ephemeral';
import * as mcpClient from '../../../services/mcp/client';
import * as mcpDbService from '../../../services/mcp/db';
import * as yamlDb from '../../../services/yaml-workflow/db';
import * as yamlDeployer from '../../../services/yaml-workflow/deployer';

/**
 * Call any tool by its qualified name — handles both YAML workflows
 * (yaml__* prefix) and raw MCP tools (server_slug__tool_name).
 *
 * Callers pass their own module-level caches so each pipeline
 * (mcpQuery, mcpTriage) keeps its own isolated cache instances.
 */
export async function callTool(
  qualifiedName: string,
  args: Record<string, any>,
  caches: {
    toolServerMap: Map<string, string>;
    yamlWorkflowMap: Map<string, string>;
  },
): Promise<any> {
  // Check if this is a compiled YAML workflow
  const yamlWorkflowName = caches.yamlWorkflowMap.get(qualifiedName);
  if (yamlWorkflowName) {
    try {
      const wf = await yamlDb.getYamlWorkflowByName(yamlWorkflowName);
      if (!wf || wf.status !== 'active') {
        return { error: `Compiled workflow "${yamlWorkflowName}" is not active` };
      }
      const toolCtx = getToolContext();
      const scopedArgs = toolCtx?.principal.id
        ? {
            ...args,
            _scope: {
              principal: toolCtx.principal,
              ...(toolCtx.initiatingPrincipal ? { initiatingPrincipal: toolCtx.initiatingPrincipal } : {}),
              scopes: toolCtx.credentials.scopes,
            },
          }
        : args;
      const { job_id, result } = await yamlDeployer.invokeYamlWorkflowSync(
        wf.app_id,
        wf.graph_topic,
        scopedArgs,
        undefined,
        wf.graph_topic,
      );
      return { job_id, workflow: yamlWorkflowName, status: 'completed', result };
    } catch (err: any) {
      return { error: err.message, tool: qualifiedName, args };
    }
  }

  // Exchange ephemeral credential tokens right before the MCP call
  args = await exchangeTokensInArgs(args);

  // Standard MCP tool routing
  const serverName = caches.toolServerMap.get(qualifiedName);
  const separatorIdx = qualifiedName.indexOf('__');
  const toolName = separatorIdx >= 0
    ? qualifiedName.slice(separatorIdx + 2)
    : qualifiedName;

  const toolCtx = getToolContext();
  const authContext = toolCtx?.principal.id
    ? { userId: toolCtx.principal.id, delegationToken: toolCtx.credentials.delegationToken }
    : undefined;

  if (serverName) {
    try {
      return await mcpClient.callServerTool(serverName, toolName, args, authContext);
    } catch (err: any) {
      return { error: err.message, tool: qualifiedName, args };
    }
  }

  // Fallback: scan all connected servers
  const { servers } = await mcpDbService.listMcpServers({ limit: 100 });
  for (const server of servers) {
    const manifest = server.tool_manifest || [];
    if (manifest.some((t: any) => t.name === toolName)) {
      try {
        return await mcpClient.callServerTool(server.name, toolName, args, authContext);
      } catch (err: any) {
        return { error: err.message, tool: qualifiedName, args };
      }
    }
  }

  return { error: `Unknown tool: ${qualifiedName} (no server found)`, tool: qualifiedName };
}
