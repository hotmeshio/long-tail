/**
 * MCP server management tools — mirrors routes/mcp.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as mcpDb from '../../../services/mcp/db';
import { mcpRegistry } from '../../../services/mcp';
import {
  listMcpServersSchema,
  updateMcpServerSchema,
  connectMcpServerSchema,
  disconnectMcpServerSchema,
} from './schemas';

export function registerMcpServerTools(server: McpServer): void {

  // mirrors GET /api/mcp/servers
  (server as any).registerTool(
    'list_mcp_servers',
    {
      title: 'List MCP Servers',
      description:
        'List registered MCP servers with optional filters by status, tags, ' +
        'or search term. Returns server name, status, tags, and tool count.',
      inputSchema: listMcpServersSchema,
    },
    async (args: z.infer<typeof listMcpServersSchema>) => {
      const tagsArray = args.tags
        ? args.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined;
      const { servers, total } = await mcpDb.listMcpServers({
        status: args.status as any,
        tags: tagsArray,
        search: args.search,
        limit: args.limit,
        offset: args.offset,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total,
            count: servers.length,
            servers: servers.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              status: s.status,
              tags: s.tags,
              auto_connect: s.auto_connect,
              tool_count: s.tool_manifest?.length ?? 0,
            })),
          }),
        }],
      };
    },
  );

  // mirrors PUT /api/mcp/servers/:id
  (server as any).registerTool(
    'update_mcp_server',
    {
      title: 'Update MCP Server',
      description:
        'Update an MCP server registration. Use this to change tags ' +
        '(which controls tool discovery scope), description, or auto_connect.',
      inputSchema: updateMcpServerSchema,
    },
    async (args: z.infer<typeof updateMcpServerSchema>) => {
      const { id, ...updates } = args;
      const updated = await mcpDb.updateMcpServer(id, updates);
      if (!updated) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'MCP server not found' }) }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            updated: true,
            server: { id: updated.id, name: updated.name, tags: updated.tags, status: updated.status },
          }),
        }],
      };
    },
  );

  // mirrors POST /api/mcp/servers/:id/connect
  (server as any).registerTool(
    'connect_mcp_server',
    {
      title: 'Connect MCP Server',
      description:
        'Connect to a registered MCP server. Re-establishes the transport ' +
        'and refreshes the tool manifest.',
      inputSchema: connectMcpServerSchema,
    },
    async (args: z.infer<typeof connectMcpServerSchema>) => {
      const adapter = mcpRegistry.current;
      if (!adapter) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'MCP adapter not registered' }) }],
          isError: true,
        };
      }
      await adapter.connectClient(args.id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ connected: true, server_id: args.id }),
        }],
      };
    },
  );

  // mirrors POST /api/mcp/servers/:id/disconnect
  (server as any).registerTool(
    'disconnect_mcp_server',
    {
      title: 'Disconnect MCP Server',
      description:
        'Disconnect from an MCP server. The server remains registered ' +
        'but its tools become unavailable until reconnected.',
      inputSchema: disconnectMcpServerSchema,
    },
    async (args: z.infer<typeof disconnectMcpServerSchema>) => {
      const adapter = mcpRegistry.current;
      if (!adapter) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'MCP adapter not registered' }) }],
          isError: true,
        };
      }
      await adapter.disconnectClient(args.id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ disconnected: true, server_id: args.id }),
        }],
      };
    },
  );
}
