import type { LTMcpAdapter, LTMcpToolManifest } from '../../types/mcp';
import { loggerRegistry } from '../../lib/logger';
import * as mcpClient from './client';
import * as mcpServer from './server';
import * as mcpDbService from './db';

import type { BuiltInMcpAdapterOptions } from './types';

/**
 * Built-in MCP adapter.
 *
 * Manages:
 * - One MCP server (human queue) that exposes escalation tools
 * - Multiple MCP client connections to external servers
 */
export class BuiltInMcpAdapter implements LTMcpAdapter {
  private readonly options: BuiltInMcpAdapterOptions;

  constructor(options?: BuiltInMcpAdapterOptions) {
    this.options = options || {};
  }

  async connect(): Promise<void> {
    // Start MCP server (human queue)
    if (this.options.server?.enabled !== false) {
      await mcpServer.createHumanQueueServer({
        name: this.options.server?.name,
      });
      loggerRegistry.info('[lt-mcp] human queue server started');
    }


    // Connect to auto-connect servers from DB
    await mcpClient.connectAutoServers();

    // Also connect to explicitly specified servers
    if (this.options.autoConnect?.length) {
      for (const serverId of this.options.autoConnect) {
        try {
          const server = await mcpDbService.getMcpServer(serverId);
          if (server) {
            await mcpClient.connectToServer(server);
          } else {
            loggerRegistry.warn(`[lt-mcp] auto-connect server not found: ${serverId}`);
          }
        } catch (err: any) {
          loggerRegistry.error(`[lt-mcp] auto-connect failed for ${serverId}: ${err.message}`);
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    await mcpClient.disconnectAll();
    await mcpServer.stopServer();
    loggerRegistry.info('[lt-mcp] disconnected');
  }

  async connectClient(serverId: string): Promise<void> {
    const server = await mcpDbService.getMcpServer(serverId);
    if (!server) throw new Error(`MCP server ${serverId} not found`);
    await mcpClient.connectToServer(server);
  }

  async disconnectClient(serverId: string): Promise<void> {
    await mcpClient.disconnectFromServer(serverId);
  }

  async listTools(serverId: string): Promise<LTMcpToolManifest[]> {
    return mcpClient.listServerTools(serverId);
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>,
    authContext?: { userId?: string; delegationToken?: string },
  ): Promise<any> {
    return mcpClient.callServerTool(serverId, toolName, args, authContext);
  }

  async toolActivities(serverId: string): Promise<Record<string, (...args: any[]) => Promise<any>>> {
    return mcpClient.toolActivities(serverId);
  }
}
