import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../services/logger';
import * as oauth from '../activities/oauth';

const getAccessTokenSchema = z.object({
  provider: z.string().describe('OAuth provider name (google, github, microsoft, etc.)'),
  user_id: z.string().describe('User ID to get token for'),
});

const listConnectionsSchema = z.object({
  user_id: z.string().describe('User ID to list connections for'),
});

const revokeConnectionSchema = z.object({
  provider: z.string().describe('OAuth provider name to disconnect'),
  user_id: z.string().describe('User ID to revoke connection for'),
});

/**
 * Create an OAuth MCP server.
 *
 * Provides 3 tools for OAuth token management:
 *   get_access_token, list_connections, revoke_connection
 *
 * Workflows call get_access_token to get fresh credentials
 * before making authenticated API calls to external services.
 */
export async function createOAuthServer(): Promise<McpServer> {
  const instance = new McpServer({ name: 'long-tail-oauth', version: '1.0.0' });

  (instance as any).registerTool(
    'get_access_token',
    {
      title: 'Get OAuth Access Token',
      description:
        'Get a fresh OAuth access token for an external service (Google, GitHub, etc.). ' +
        'Automatically refreshes expired tokens. Call this immediately before making an ' +
        'authenticated API request — do not cache or reuse across workflow steps.',
      inputSchema: getAccessTokenSchema,
    },
    async (args: z.infer<typeof getAccessTokenSchema>) => {
      const result = await oauth.getAccessToken(args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  (instance as any).registerTool(
    'list_connections',
    {
      title: 'List OAuth Connections',
      description: 'List all OAuth providers connected for a user.',
      inputSchema: listConnectionsSchema,
    },
    async (args: z.infer<typeof listConnectionsSchema>) => {
      const result = await oauth.listConnections(args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  (instance as any).registerTool(
    'revoke_connection',
    {
      title: 'Revoke OAuth Connection',
      description: 'Disconnect an OAuth provider for a user, removing stored tokens.',
      inputSchema: revokeConnectionSchema,
    },
    async (args: z.infer<typeof revokeConnectionSchema>) => {
      const result = await oauth.revokeConnection(args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  loggerRegistry.info('[lt-mcp:oauth] long-tail-oauth ready (3 tools registered)');
  return instance;
}
