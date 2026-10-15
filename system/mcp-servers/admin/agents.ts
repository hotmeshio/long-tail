/**
 * Agent automation tools — mirrors routes/agents.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as api from '../../../api/agents';
import { assertMayConfigureAgent } from '../../../services/agent/authority';
import { InvocationError } from '../../../services/workflow-invocation';
import { externalCaller, type ToolCallExtra } from '../caller-auth';
import {
  listAgentsSchema,
  getAgentSchema,
  createAgentSchema,
  updateAgentSchema,
  deleteAgentSchema,
} from './schemas';

/** An MCP error for a refused authority check; null when the call may go on. */
async function refusal(check: () => Promise<void>) {
  try {
    await check();
    return null;
  } catch (err: any) {
    if (!(err instanceof InvocationError)) throw err;
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
  }
}

export function registerAgentTools(server: McpServer): void {

  // mirrors GET /api/agents
  (server as any).registerTool(
    'list_agents',
    {
      title: 'List Agents',
      description:
        'List agent automations with optional status and knowledge domain filters. ' +
        'Returns agents with subscription counts and topic lists.',
      inputSchema: listAgentsSchema,
    },
    async (args: z.infer<typeof listAgentsSchema>) => {
      const result = await api.listAgents(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/agents/:id
  (server as any).registerTool(
    'get_agent',
    {
      title: 'Get Agent',
      description:
        'Get a single agent automation by ID, including aggregated stats ' +
        '(knowledge entry count, escalation count).',
      inputSchema: getAgentSchema,
    },
    async (args: z.infer<typeof getAgentSchema>) => {
      const result = await api.getAgent(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/agents
  (server as any).registerTool(
    'create_agent',
    {
      title: 'Create Agent',
      description:
        'Create a new agent automation with identity, goals, rules, ' +
        'optional schedules, and event subscriptions.',
      inputSchema: createAgentSchema,
    },
    async (args: z.infer<typeof createAgentSchema>, extra?: ToolCallExtra) => {
      const caller = externalCaller(extra);
      const refused = caller ? await refusal(() => assertMayConfigureAgent(caller.userId, { ...(args as any), id: undefined })) : null;
      if (refused) return refused;
      const result = await api.createAgent(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors PUT /api/agents/:id
  (server as any).registerTool(
    'update_agent',
    {
      title: 'Update Agent',
      description: 'Update an existing agent automation.',
      inputSchema: updateAgentSchema,
    },
    async (args: z.infer<typeof updateAgentSchema>, extra?: ToolCallExtra) => {
      const caller = externalCaller(extra);
      const refused = caller ? await refusal(() => assertMayConfigureAgent(caller.userId, args as any)) : null;
      if (refused) return refused;
      const result = await api.updateAgent(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors DELETE /api/agents/:id
  (server as any).registerTool(
    'delete_agent',
    {
      title: 'Delete Agent',
      description: 'Delete an agent automation and all its subscriptions.',
      inputSchema: deleteAgentSchema,
    },
    async (args: z.infer<typeof deleteAgentSchema>) => {
      const result = await api.deleteAgent(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
