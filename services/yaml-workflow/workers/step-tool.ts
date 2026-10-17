import { getToolContext } from '../../iam/context';
import * as mcpClient from '../../mcp/client';
import { dispatchBuiltinTool } from '../../mcp/client/connection';

/**
 * Call a step's tool. A built-in tool runs as the principal the workflow was
 * started for (its `_scope`), under the tool's manifest gate, so a step never
 * does more than its invoker may. A run started in-process with no principal
 * calls it as lt-system. Other servers are called as before.
 */
export async function callStepTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<any> {
  const [{ builtinServerFor, builtinToolGate }, { currentToolPrincipal }] = await Promise.all([
    import('../../../api/mcp/tools'),
    import('../../../system/workflows/shared/principal-tools'),
  ]);
  const builtin = await builtinServerFor(serverId);
  if (!builtin) return mcpClient.callServerTool(serverId, toolName, args);

  const principal = await currentToolPrincipal();
  if (!principal) {
    const dispatched = await dispatchBuiltinTool(builtin, toolName, args);
    if (!dispatched) throw new Error(`Tool ${toolName} not found on ${builtin}`);
    return dispatched.result;
  }
  if (!(await principal.access(builtinToolGate(builtin, toolName)))) {
    return { error: `${toolName} is not available to this caller` };
  }
  const ctx = getToolContext();
  const credentials = ctx?.principal.id
    ? { userId: ctx.principal.id, delegationToken: ctx.credentials.delegationToken }
    : undefined;
  return mcpClient.callBuiltinToolAs(builtin, toolName, args, { userId: principal.userId }, credentials);
}
