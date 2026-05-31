import { callServerTool } from '../../../services/mcp/client/tools';

/**
 * Invoke a single MCP server tool (capability).
 *
 * This is the durable activity that wraps `callServerTool`.
 * Running as a proxied activity gives crash safety — if the
 * container dies mid-call, HotMesh retries on another container.
 */
export async function callCapability(input: {
  serverId: string;
  toolName: string;
  arguments: Record<string, any>;
}): Promise<any> {
  return callServerTool(
    input.serverId,
    input.toolName,
    input.arguments,
  );
}
