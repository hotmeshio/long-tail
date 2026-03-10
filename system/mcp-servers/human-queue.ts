import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../services/logger';
import * as escalationService from '../../services/escalation';

let server: McpServer | null = null;

// ── Schemas (extracted to break TS2589 deep-instantiation in registerTool generics) ──

const escalateSchema = z.object({
  role: z.string().describe('Target role for the escalation (e.g., "reviewer")'),
  message: z.string().describe('Description of what needs human review'),
  data: z.record(z.any()).optional().describe('Contextual data for the reviewer'),
  type: z.string().optional().default('mcp').describe('Escalation type classification'),
  subtype: z.string().optional().default('tool_call').describe('Escalation subtype'),
  priority: z.number().min(1).max(4).optional().default(2)
    .describe('Priority: 1 (highest) to 4 (lowest)'),
});

const checkResolutionSchema = z.object({
  escalation_id: z.string().describe('The escalation ID to check'),
});

const getAvailableWorkSchema = z.object({
  role: z.string().describe('Role to filter by'),
  limit: z.number().optional().default(10).describe('Max results to return'),
});

const claimAndResolveSchema = z.object({
  escalation_id: z.string().describe('The escalation ID to claim and resolve'),
  resolver_id: z.string().describe('Identifier for who/what is resolving'),
  payload: z.record(z.any()).describe('Resolution payload data'),
});

/**
 * Create the Long Tail Human Queue MCP server.
 *
 * Registers four tools that expose the escalation API:
 * - escalate_to_human — create a new escalation
 * - check_resolution — check escalation status
 * - get_available_work — list available escalations by role
 * - claim_and_resolve — claim + resolve in one step
 *
 * The server is created with tools registered but no transport
 * auto-connected. Callers connect a transport programmatically
 * or via the Streamable HTTP endpoint.
 */
export async function createHumanQueueServer(options?: {
  name?: string;
}): Promise<McpServer> {
  if (server) return server;

  const name = options?.name || 'long-tail-human-queue';
  server = new McpServer({ name, version: '1.0.0' });

  // ── escalate_to_human ───────────────────────────────────────────────
  (server as any).registerTool(
    'escalate_to_human',
    {
      title: 'Escalate to Human',
      description: 'Create a new escalation for human review. Returns the escalation ID.',
      inputSchema: escalateSchema,
    },
    async (args: z.infer<typeof escalateSchema>) => {
      const escalation = await escalationService.createEscalation({
        type: args.type || 'mcp',
        subtype: args.subtype || 'tool_call',
        modality: 'mcp',
        description: args.message,
        priority: args.priority,
        role: args.role,
        envelope: JSON.stringify(args.data || {}),
        metadata: { source: 'mcp_server' },
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            escalation_id: escalation.id,
            status: escalation.status,
            role: escalation.role,
            created_at: escalation.created_at,
          }),
        }],
      };
    },
  );

  // ── check_resolution ────────────────────────────────────────────────
  (server as any).registerTool(
    'check_resolution',
    {
      title: 'Check Escalation Resolution',
      description: 'Check the status of an escalation. Returns status and resolver payload if resolved.',
      inputSchema: checkResolutionSchema,
    },
    async (args: z.infer<typeof checkResolutionSchema>) => {
      const escalation = await escalationService.getEscalation(args.escalation_id);
      if (!escalation) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Escalation not found' }),
          }],
          isError: true,
        };
      }
      const result: Record<string, any> = {
        escalation_id: escalation.id,
        status: escalation.status,
      };
      if (escalation.status === 'resolved' && escalation.resolver_payload) {
        try {
          result.resolver_payload = JSON.parse(escalation.resolver_payload);
        } catch {
          result.resolver_payload = escalation.resolver_payload;
        }
        result.resolved_at = escalation.resolved_at;
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // ── get_available_work ──────────────────────────────────────────────
  (server as any).registerTool(
    'get_available_work',
    {
      title: 'Get Available Work',
      description: 'List available escalations for a role. Returns pending, unassigned escalations.',
      inputSchema: getAvailableWorkSchema,
    },
    async (args: z.infer<typeof getAvailableWorkSchema>) => {
      const { escalations } = await escalationService.listAvailableEscalations({
        role: args.role,
        limit: args.limit,
      });
      const items = escalations.map((e) => ({
        escalation_id: e.id,
        type: e.type,
        subtype: e.subtype,
        description: e.description,
        priority: e.priority,
        role: e.role,
        created_at: e.created_at,
      }));
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: items.length, escalations: items }),
        }],
      };
    },
  );

  // ── claim_and_resolve ───────────────────────────────────────────────
  (server as any).registerTool(
    'claim_and_resolve',
    {
      title: 'Claim and Resolve',
      description: 'Claim an escalation and immediately resolve it with a payload. Atomic operation.',
      inputSchema: claimAndResolveSchema,
    },
    async (args: z.infer<typeof claimAndResolveSchema>) => {
      const claimed = await escalationService.claimEscalation(
        args.escalation_id,
        args.resolver_id,
        5, // 5 minute claim for immediate resolution
      );
      if (!claimed) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Escalation not available for claim' }),
          }],
          isError: true,
        };
      }
      const resolved = await escalationService.resolveEscalation(
        args.escalation_id,
        args.payload,
      );
      if (!resolved) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Failed to resolve escalation' }),
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            escalation_id: resolved.id,
            status: resolved.status,
            resolved_at: resolved.resolved_at,
          }),
        }],
      };
    },
  );

  loggerRegistry.info(`[lt-mcp:server] ${name} ready (4 tools registered)`);
  return server;
}

/**
 * Get the current MCP server instance.
 */
export function getServer(): McpServer | null {
  return server;
}

/**
 * Stop the MCP server and release resources.
 */
export async function stopServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    loggerRegistry.info('[lt-mcp:server] stopped');
  }
}
