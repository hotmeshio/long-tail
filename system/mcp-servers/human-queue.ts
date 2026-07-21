import * as crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../lib/logger';
import * as escalationService from '../../services/escalation';
import { checkResolverPayload, toValidationErrorBody } from '../../services/escalation/resolver-validation';
import { getEnforcingRoles } from '../../services/role/enforcement-cache';
import { ESCALATION_METADATA_KEYS } from '../../types/escalation';
import {
  escalateSchema,
  checkResolutionSchema,
  getAvailableWorkSchema,
  claimAndResolveSchema,
  resolveEscalationSchema,
  escalateAndWaitSchema,
} from './human-queue-schemas';

let server: McpServer | null = null;

/**
 * Schema enforcement for the MCP resolve tools — the same gate the HTTP
 * surfaces run (agents and the sim workforce submit through these tools, so
 * they get the same contract and the same canonical violation body). Costs
 * zero reads when no role enforces (cached set); otherwise one row read.
 * Returns the MCP error content when the payload is rejected, null to proceed.
 */
async function checkResolveToolPayload(
  escalationId: string,
  payload: Record<string, any>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError: true } | null> {
  const enforcing = await getEnforcingRoles();
  if (enforcing.size === 0) return null;
  const escalation = await escalationService.getEscalation(escalationId);
  if (!escalation || !enforcing.has(escalation.role)) return null;
  const report = await checkResolverPayload(escalation, payload);
  if (!report) return null;
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(toValidationErrorBody(report)),
    }],
    isError: true,
  };
}

/**
 * Create the Long Tail Human Queue MCP server.
 *
 * Registers five tools that expose the escalation API:
 * - escalate_to_human — create a new escalation (fire-and-forget)
 * - check_resolution — check escalation status
 * - get_available_work — list available escalations by role
 * - claim_and_resolve — claim + resolve in one step
 * - escalate_and_wait — create escalation and return signal for durable wait
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
      const metadata: Record<string, any> = { source: 'mcp_server' };
      if (args.schema_version != null) {
        metadata[ESCALATION_METADATA_KEYS.SCHEMA_VERSION] = args.schema_version;
      }
      const escalation = await escalationService.createEscalation({
        type: args.type || 'mcp',
        subtype: args.subtype || 'tool_call',
        description: args.message,
        priority: args.priority,
        role: args.role,
        envelope: JSON.stringify(args.data || {}),
        metadata,
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
      description: 'Check an escalation. When resolved, returns the resolver payload. When pending, returns the role\'s form_schema — the fields (and their x-lt-bind payload paths) to submit when resolving.',
      inputSchema: checkResolutionSchema,
    },
    async (args: z.infer<typeof checkResolutionSchema>) => {
      // Single query: the escalation plus its role's form, resolved to the pinned
      // version (or latest) — the same JOIN the HTTP GET uses, so an agent sees
      // the same form the dashboard renders.
      const detail = await escalationService.getEscalationWithFormSchema(args.escalation_id);
      if (!detail) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Escalation not found' }),
          }],
          isError: true,
        };
      }
      const escalation = detail.escalation;
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
      } else if (escalation.status === 'pending' && detail.form_schema) {
        // The shape the resolver payload should take (fields + x-lt-bind paths).
        result.form_schema = detail.form_schema;
        // Tell the agent when this role ENFORCES the form: an incomplete or
        // mis-typed payload will be rejected with a schema_validation error.
        if ((await getEnforcingRoles()).has(escalation.role)) {
          result.schema_enforced = true;
        }
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
      description: 'Claim an escalation and immediately resolve it with a payload. Atomic operation. Roles with enforce_schema validate the payload against the form_schema (see check_resolution) and reject violations with a schema_validation error listing each field.',
      inputSchema: claimAndResolveSchema,
    },
    async (args: z.infer<typeof claimAndResolveSchema>) => {
      // Validate BEFORE claiming — a rejected payload must never strand a claim.
      const rejected = await checkResolveToolPayload(args.escalation_id, args.payload);
      if (rejected) return rejected;

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

  // ── resolve_escalation ──────────────────────────────────────────────
  (server as any).registerTool(
    'resolve_escalation',
    {
      title: 'Resolve Escalation',
      description: 'Resolve an already-claimed escalation with a payload. Use when the claim happened externally (e.g. via API). Roles with enforce_schema validate the payload against the form_schema (see check_resolution) and reject violations with a schema_validation error listing each field.',
      inputSchema: resolveEscalationSchema,
    },
    async (args: z.infer<typeof resolveEscalationSchema>) => {
      const rejected = await checkResolveToolPayload(args.escalation_id, args.payload);
      if (rejected) return rejected;

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

  // ── escalate_and_wait ──────────────────────────────────────────────
  (server as any).registerTool(
    'escalate_and_wait',
    {
      title: 'Escalate and Wait',
      description:
        'Create an escalation and pause the workflow until a human responds. ' +
        'Returns a signal ID that the workflow uses to wait. ' +
        'Preferred over escalate_to_human + check_resolution polling.',
      inputSchema: escalateAndWaitSchema,
    },
    async (args: z.infer<typeof escalateAndWaitSchema> & { _yaml_signal_routing?: Record<string, any> }) => {
      const signalId = `wait-for-human-${crypto.randomUUID()}`;

      // YAML workflows inject _yaml_signal_routing to override Durable's signalId-based routing
      const yamlRouting = args._yaml_signal_routing;
      const signalRouting = yamlRouting
        ? { ...yamlRouting, signalId }
        : { signalId };

      const metadata: Record<string, any> = {
        source: 'mcp_server',
        signal_routing: signalRouting,
      };
      if (args.form_schema) {
        metadata[ESCALATION_METADATA_KEYS.FORM_SCHEMA] = args.form_schema;
      }
      if (args.schema_version != null) {
        metadata[ESCALATION_METADATA_KEYS.SCHEMA_VERSION] = args.schema_version;
      }

      const escalation = await escalationService.createEscalation({
        type: args.type || 'mcp',
        subtype: args.subtype || 'wait_for_human',
        description: args.message,
        priority: args.priority,
        role: args.role,
        envelope: JSON.stringify(args.data || {}),
        metadata,
        // YAML routing provides workflow context for dashboard visibility
        workflow_type: yamlRouting?.workflowType,
        workflow_id: yamlRouting?.workflowId,
        task_queue: yamlRouting?.taskQueue,
      });

      if (args.assigned_to) {
        await escalationService.claimEscalation(escalation.id, args.assigned_to, 240);
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            type: 'waitFor',
            signalId,
            escalationId: escalation.id,
          }),
        }],
      };
    },
  );

  loggerRegistry.info(`[lt-mcp:server] ${name} ready (5 tools registered)`);
  return server;
}

/** Get the current MCP server instance. */
export function getServer(): McpServer | null {
  return server;
}

/** Stop the MCP server and release resources. */
export async function stopServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    loggerRegistry.info('[lt-mcp:server] stopped');
  }
}
