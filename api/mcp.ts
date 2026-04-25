import * as mcpDbService from '../services/mcp/db';
import { mcpRegistry } from '../services/mcp';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

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
