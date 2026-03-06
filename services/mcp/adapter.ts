import type { LTMcpAdapter, LTMcpToolManifest } from '../../types/mcp';
import { loggerRegistry } from '../logger';
import * as mcpClient from './client';
import * as mcpServer from './server';
import * as mcpDbServer from './db-server';
import * as mcpTelemetryServer from './telemetry-server';
import * as mcpWorkflowCompilerServer from './workflow-compiler-server';
import * as mcpDbService from './db';

export interface BuiltInMcpAdapterOptions {
  server?: {
    enabled?: boolean;
    name?: string;
  };
  autoConnect?: string[];
}

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

    // Start DB query MCP server (always available)
    await mcpDbServer.createDbServer();
    loggerRegistry.info('[lt-mcp] db query server started');

    // Start Telemetry MCP server (when Honeycomb is configured)
    if (process.env.HONEYCOMB_API_KEY) {
      await mcpTelemetryServer.createTelemetryServer();
      loggerRegistry.info('[lt-mcp] telemetry server started');
    }

    // Start Workflow Compiler MCP server (always available)
    await mcpWorkflowCompilerServer.createWorkflowCompilerServer();
    loggerRegistry.info('[lt-mcp] workflow compiler server started');

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
    await mcpWorkflowCompilerServer.stopWorkflowCompilerServer();
    await mcpTelemetryServer.stopTelemetryServer();
    await mcpDbServer.stopDbServer();
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

  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<any> {
    return mcpClient.callServerTool(serverId, toolName, args);
  }

  async toolActivities(serverId: string): Promise<Record<string, (...args: any[]) => Promise<any>>> {
    return mcpClient.toolActivities(serverId);
  }
}
