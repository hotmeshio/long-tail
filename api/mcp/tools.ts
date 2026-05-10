import { mcpRegistry } from '../../services/mcp';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

/**
 * List all tools exposed by a connected MCP server.
 *
 * Requires the MCP adapter to be registered and the server to be connected.
 *
 * @param input.id — the MCP server identifier
 * @returns `{ status: 200, data: { tools } }` array of tool descriptors
 */
export async function listMcpServerTools(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const adapter = mcpRegistry.current;
    if (!adapter) {
      return { status: 400, error: 'MCP adapter not registered' };
    }
    const tools = await adapter.listTools(input.id);
    return { status: 200, data: { tools } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Invoke a specific tool on a connected MCP server.
 *
 * Passes the tool arguments and an optional auth context (derived from
 * `execute_as` or the authenticated user) to the MCP adapter. Returns
 * 422 with `missing_credential` if the tool requires a credential the
 * user has not registered.
 *
 * @param input.id — the MCP server identifier
 * @param input.toolName — name of the tool to invoke
 * @param input.arguments — key-value arguments to pass to the tool
 * @param input.execute_as — optional user ID to impersonate for the tool call
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { result } }` the tool execution result
 */
export async function callMcpTool(
  input: {
    id: string;
    toolName: string;
    arguments?: Record<string, any>;
    execute_as?: string;
  },
  auth?: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const adapter = mcpRegistry.current;
    if (!adapter) {
      return { status: 400, error: 'MCP adapter not registered' };
    }
    const authContext = (input.execute_as || auth?.userId)
      ? { userId: input.execute_as || auth?.userId }
      : undefined;
    const result = await adapter.callTool(
      input.id,
      input.toolName,
      input.arguments || {},
      authContext,
    );
    return { status: 200, data: { result } };
  } catch (err: any) {
    if (err.name === 'MissingCredentialError') {
      return {
        status: 422,
        error: 'missing_credential',
        ...({ provider: err.provider, message: err.message } as any),
      };
    }
    return { status: 500, error: err.message };
  }
}
