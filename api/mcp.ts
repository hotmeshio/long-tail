import * as mcpDbService from '../services/mcp/db';
import { mcpRegistry } from '../services/mcp';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

/**
 * List registered MCP servers with optional filtering and pagination.
 *
 * @param input.status — filter by server status (e.g. 'active', 'inactive')
 * @param input.auto_connect — filter by auto-connect setting
 * @param input.search — free-text search across server names and descriptions
 * @param input.tags — filter to servers matching any of these tags
 * @param input.limit — maximum number of results to return
 * @param input.offset — pagination offset
 * @returns `{ status: 200, data: { ... } }` paginated list of MCP server records
 */
export async function listMcpServers(input: {
  status?: string;
  auto_connect?: boolean;
  search?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}): Promise<LTApiResult> {
  try {
    const result = await mcpDbService.listMcpServers(input as any);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Register a new MCP server.
 *
 * Returns 409 if a server with the same name already exists.
 *
 * @param input.name — unique display name for the server (required)
 * @param input.description — optional human-readable description
 * @param input.transport_type — transport protocol, e.g. 'sse', 'stdio' (required)
 * @param input.transport_config — transport-specific connection settings (required)
 * @param input.auto_connect — whether to connect automatically on startup
 * @param input.metadata — arbitrary key-value metadata
 * @param input.tags — tags for categorization and filtering
 * @param input.compile_hints — optional hints used during tool compilation
 * @param input.credential_providers — OAuth/credential provider identifiers required by this server
 * @returns `{ status: 201, data: { ... } }` the created MCP server record
 */
export async function createMcpServer(input: {
  name: string;
  description?: string;
  transport_type: string;
  transport_config: Record<string, any>;
  auto_connect?: boolean;
  metadata?: Record<string, any>;
  tags?: string[];
  compile_hints?: any;
  credential_providers?: string[];
}): Promise<LTApiResult> {
  try {
    if (!input.name || !input.transport_type || !input.transport_config) {
      return { status: 400, error: 'name, transport_type, and transport_config are required' };
    }
    const server = await mcpDbService.createMcpServer(input as any);
    return { status: 201, data: server };
  } catch (err: any) {
    if (err.message?.includes('duplicate key') || err.code === '23505') {
      return { status: 409, error: 'MCP server with that name already exists' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Test connectivity to an MCP server without persisting it.
 *
 * Attempts to establish a connection using the provided transport
 * configuration and returns the result. On failure, returns a
 * successful (200) response with `success: false` and the error message.
 *
 * @param input.transport_type — transport protocol to test (required)
 * @param input.transport_config — transport-specific connection settings (required)
 * @returns `{ status: 200, data: { success, error?, tools } }` connection test result
 */
export async function testConnection(input: {
  transport_type: string;
  transport_config: Record<string, any>;
}): Promise<LTApiResult> {
  try {
    if (!input.transport_type || !input.transport_config) {
      return { status: 400, error: 'transport_type and transport_config are required' };
    }
    const { testConnection: testConn } = await import('../services/mcp/client/connection');
    const result = await testConn(input.transport_type as any, input.transport_config);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 200, data: { success: false, error: err.message, tools: [] } };
  }
}

/**
 * Retrieve a single MCP server by ID.
 *
 * @param input.id — the MCP server identifier
 * @returns `{ status: 200, data: { ... } }` the MCP server record, or 404 if not found
 */
export async function getMcpServer(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const server = await mcpDbService.getMcpServer(input.id);
    if (!server) {
      return { status: 404, error: 'MCP server not found' };
    }
    return { status: 200, data: server };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Update fields on an existing MCP server.
 *
 * Accepts any subset of mutable server fields alongside the required ID.
 *
 * @param input.id — the MCP server identifier (required)
 * @param input.[key] — any mutable server field to update (name, description, transport_config, etc.)
 * @returns `{ status: 200, data: { ... } }` the updated server record, or 404 if not found
 */
export async function updateMcpServer(input: {
  id: string;
  [key: string]: any;
}): Promise<LTApiResult> {
  try {
    const { id, ...fields } = input;
    const server = await mcpDbService.updateMcpServer(id, fields);
    if (!server) {
      return { status: 404, error: 'MCP server not found' };
    }
    return { status: 200, data: server };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Delete an MCP server by ID.
 *
 * @param input.id — the MCP server identifier
 * @returns `{ status: 200, data: { deleted: true } }` on success, or 404 if not found
 */
export async function deleteMcpServer(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const deleted = await mcpDbService.deleteMcpServer(input.id);
    if (!deleted) {
      return { status: 404, error: 'MCP server not found' };
    }
    return { status: 200, data: { deleted: true } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Establish a live connection to a registered MCP server.
 *
 * Requires the MCP adapter to be registered in the registry.
 *
 * @param input.id — the MCP server identifier to connect
 * @returns `{ status: 200, data: { connected, serverId } }` confirmation of the connection
 */
export async function connectMcpServer(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const adapter = mcpRegistry.current;
    if (!adapter) {
      return { status: 400, error: 'MCP adapter not registered' };
    }
    await adapter.connectClient(input.id);
    return { status: 200, data: { connected: true, serverId: input.id } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Disconnect a live MCP server connection.
 *
 * Requires the MCP adapter to be registered in the registry.
 *
 * @param input.id — the MCP server identifier to disconnect
 * @returns `{ status: 200, data: { disconnected, serverId } }` confirmation of the disconnection
 */
export async function disconnectMcpServer(input: {
  id: string;
}): Promise<LTApiResult> {
  try {
    const adapter = mcpRegistry.current;
    if (!adapter) {
      return { status: 400, error: 'MCP adapter not registered' };
    }
    await adapter.disconnectClient(input.id);
    return { status: 200, data: { disconnected: true, serverId: input.id } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Check which credential providers are registered vs missing for an MCP server.
 *
 * Resolves each credential provider required by the server against the
 * authenticated user's stored credentials.
 *
 * @param input.id — the MCP server identifier
 * @param auth — authenticated user context used to resolve credentials
 * @returns `{ status: 200, data: { required, registered, missing } }` credential status arrays
 */
export async function getCredentialStatus(
  input: { id: string },
  auth?: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const server = await mcpDbService.getMcpServer(input.id);
    if (!server) {
      return { status: 404, error: 'MCP server not found' };
    }
    const required: string[] = server.credential_providers ?? [];
    const registered: string[] = [];
    const missing: string[] = [];

    if (auth?.userId && required.length > 0) {
      const { resolveCredential } = await import('../services/iam/credentials');
      for (const provider of required) {
        const cred = await resolveCredential(
          { id: auth.userId, type: 'user', roles: [] },
          provider,
        );
        if (cred) registered.push(provider);
        else missing.push(provider);
      }
    } else {
      missing.push(...required);
    }

    return { status: 200, data: { required, registered, missing } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

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
