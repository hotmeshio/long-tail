/**
 * Agent subscription tools — mirrors routes/agents.ts subscription routes
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as api from '../../../api/agent-subscriptions';
import {
  listAgentSubscriptionsSchema,
  createAgentSubscriptionSchema,
  deleteAgentSubscriptionSchema,
} from './schemas';

export function registerAgentSubscriptionTools(server: McpServer): void {

  // mirrors GET /api/agents/:agentId/subscriptions
  (server as any).registerTool(
    'list_agent_subscriptions',
    {
      title: 'List Agent Subscriptions',
      description:
        'List all event subscriptions for an agent automation.',
      inputSchema: listAgentSubscriptionsSchema,
    },
    async (args: z.infer<typeof listAgentSubscriptionsSchema>) => {
      const result = await api.listSubscriptions({ agentId: args.agent_id });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/agents/:agentId/subscriptions
  (server as any).registerTool(
    'create_agent_subscription',
    {
      title: 'Create Agent Subscription',
      description:
        'Create an event subscription for an agent. When events match the ' +
        'topic pattern, the configured reaction is triggered.',
      inputSchema: createAgentSubscriptionSchema,
    },
    async (args: z.infer<typeof createAgentSubscriptionSchema>) => {
      const { agent_id, ...body } = args;
      const result = await api.createSubscription({ agentId: agent_id, ...body });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors DELETE /api/agents/:agentId/subscriptions/:subId
  (server as any).registerTool(
    'delete_agent_subscription',
    {
      title: 'Delete Agent Subscription',
      description: 'Delete an event subscription by ID.',
      inputSchema: deleteAgentSubscriptionSchema,
    },
    async (args: z.infer<typeof deleteAgentSubscriptionSchema>) => {
      const result = await api.deleteSubscription({ id: args.id });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
