/**
 * Bot account tools — mirrors routes/bot-accounts.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as api from '../../../api/bot-accounts';
import { getBotApiKeyOwner } from '../../../services/auth/bot-api-key';
import { mayGrantRoles, mayManageAccount, type GrantDecision } from '../../../modules/capabilities';
import { externalCaller, type ToolCallExtra } from '../caller-auth';
import {
  listBotsSchema,
  getBotSchema,
  createBotSchema,
  updateBotSchema,
  deleteBotSchema,
  createBotApiKeySchema,
  revokeBotKeySchema,
} from './schemas';

/** An MCP error for a refused decision; null when the call may go on. */
function refusal(decision: GrantDecision) {
  if (decision.allowed) return null;
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: decision.error }) }], isError: true };
}

/** For a /mcp caller, the account rule on `botId`; internal calls act as lt-system. */
async function accountRefusal(extra: ToolCallExtra | undefined, botId: string | null) {
  const caller = externalCaller(extra);
  if (!caller || !botId) return null;
  return refusal(await mayManageAccount(caller.userId, botId));
}

export function registerBotAccountTools(server: McpServer): void {

  // mirrors GET /api/bot-accounts
  (server as any).registerTool(
    'list_bot_accounts',
    {
      title: 'List Bot Accounts',
      description: 'List all bot (service) accounts with pagination.',
      inputSchema: listBotsSchema,
    },
    async (args: z.infer<typeof listBotsSchema>) => {
      const result = await api.listBots(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/bot-accounts/:id
  (server as any).registerTool(
    'get_bot_account',
    {
      title: 'Get Bot Account',
      description: 'Get a single bot account by ID.',
      inputSchema: getBotSchema,
    },
    async (args: z.infer<typeof getBotSchema>) => {
      const result = await api.getBot(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/bot-accounts
  (server as any).registerTool(
    'create_bot_account',
    {
      title: 'Create Bot Account',
      description:
        'Create a new bot (service) account with optional roles. ' +
        'Bot accounts can run workflows and hold API keys.',
      inputSchema: createBotSchema,
    },
    async (args: z.infer<typeof createBotSchema>, extra?: ToolCallExtra) => {
      const caller = externalCaller(extra);
      const refused = caller ? refusal(await mayGrantRoles(caller.userId, args.roles)) : null;
      if (refused) return refused;
      const result = await api.createBot(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors PUT /api/bot-accounts/:id
  (server as any).registerTool(
    'update_bot_account',
    {
      title: 'Update Bot Account',
      description: 'Update a bot account (display name, description, status).',
      inputSchema: updateBotSchema,
    },
    async (args: z.infer<typeof updateBotSchema>, extra?: ToolCallExtra) => {
      const refused = await accountRefusal(extra, args.id);
      if (refused) return refused;
      const result = await api.updateBot(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors DELETE /api/bot-accounts/:id
  (server as any).registerTool(
    'delete_bot_account',
    {
      title: 'Delete Bot Account',
      description: 'Delete a bot account and all its API keys.',
      inputSchema: deleteBotSchema,
    },
    async (args: z.infer<typeof deleteBotSchema>, extra?: ToolCallExtra) => {
      const refused = await accountRefusal(extra, args.id);
      if (refused) return refused;
      const result = await api.deleteBot(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/bot-accounts/:id/api-keys
  (server as any).registerTool(
    'create_bot_api_key',
    {
      title: 'Create Bot API Key',
      description:
        'Generate a new API key for a bot account. Returns the raw key ' +
        'ONCE — it cannot be retrieved again.',
      inputSchema: createBotApiKeySchema,
    },
    async (args: z.infer<typeof createBotApiKeySchema>, extra?: ToolCallExtra) => {
      const refused = await accountRefusal(extra, args.id);
      if (refused) return refused;
      const result = await api.createBotKey(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors DELETE /api/bot-accounts/:id/api-keys/:keyId
  (server as any).registerTool(
    'revoke_bot_api_key',
    {
      title: 'Revoke Bot API Key',
      description: 'Revoke (delete) an API key for a bot account.',
      inputSchema: revokeBotKeySchema,
    },
    async (args: z.infer<typeof revokeBotKeySchema>, extra?: ToolCallExtra) => {
      const refused = externalCaller(extra) ? await accountRefusal(extra, await getBotApiKeyOwner(args.key_id)) : null;
      if (refused) return refused;
      const result = await api.revokeBotKey({ keyId: args.key_id });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
