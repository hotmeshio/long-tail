/**
 * Escalation tools — mirrors routes/escalations/
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as escalationService from '../../../services/escalation';
import * as escalationMetaApi from '../../../api/escalations/metadata';
import * as escalationBulkApi from '../../../api/escalations/bulk';
import {
  findEscalationsSchema,
  getEscalationStatsSchema,
  claimEscalationSchema,
  releaseExpiredClaimsSchema,
  bulkTriageSchema,
  findByMetadataSchema,
  claimByMetadataSchema,
  resolveByMetadataSchema,
  bulkClaimSchema,
  bulkAssignSchema,
  bulkEscalateSchema,
  updatePrioritySchema,
} from './schemas';

export function registerEscalationTools(server: McpServer): void {

  // mirrors GET /api/escalations
  (server as any).registerTool(
    'find_escalations',
    {
      title: 'Find Escalations',
      description:
        'Search escalations with optional filters. Returns records with ' +
        'type, role, priority, status, description, and assignment info.',
      inputSchema: findEscalationsSchema,
    },
    async (args: z.infer<typeof findEscalationsSchema>) => {
      const { escalations, total } = await escalationService.listEscalations({
        status: args.status as any,
        role: args.role,
        type: args.type,
        priority: args.priority,
        limit: args.limit,
        offset: args.offset,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total,
            count: escalations.length,
            escalations: escalations.map((e) => ({
              id: e.id,
              type: e.type,
              subtype: e.subtype,
              role: e.role,
              priority: e.priority,
              status: e.status,
              description: e.description,
              workflow_type: e.workflow_type,
              assigned_to: e.assigned_to,
              created_at: e.created_at,
            })),
          }),
        }],
      };
    },
  );

  // mirrors GET /api/escalations/stats
  (server as any).registerTool(
    'get_escalation_stats',
    {
      title: 'Get Escalation Stats',
      description:
        'Aggregated escalation statistics: pending, claimed, created, ' +
        'resolved counts with breakdown by role and type.',
      inputSchema: getEscalationStatsSchema,
    },
    async (args: z.infer<typeof getEscalationStatsSchema>) => {
      const stats = await escalationService.getEscalationStats(undefined, args.period);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(stats),
        }],
      };
    },
  );

  // mirrors POST /api/escalations/:id/claim
  (server as any).registerTool(
    'claim_escalation',
    {
      title: 'Claim Escalation',
      description:
        'Claim an escalation for a time-boxed lock. The escalation is ' +
        'reserved so no one else picks it up. If the claim expires, ' +
        'the escalation returns to the queue.',
      inputSchema: claimEscalationSchema,
    },
    async (args: z.infer<typeof claimEscalationSchema>) => {
      const escalation = await escalationService.getEscalation(args.id);
      if (!escalation) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Escalation not found' }) }],
          isError: true,
        };
      }
      const result = await escalationService.claimEscalation(
        args.id,
        'lt-system',
        args.duration_minutes,
      );
      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Escalation not available for claim' }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // mirrors POST /api/escalations/release-expired
  (server as any).registerTool(
    'release_expired_claims',
    {
      title: 'Release Expired Claims',
      description:
        'Release all escalation claims that exceeded their lock duration. ' +
        'Expired escalations return to the available queue.',
      inputSchema: releaseExpiredClaimsSchema,
    },
    async (_args: z.infer<typeof releaseExpiredClaimsSchema>) => {
      const released = await escalationService.releaseExpiredClaims();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ released }) }],
      };
    },
  );

  // mirrors POST /api/escalations/bulk-triage
  (server as any).registerTool(
    'bulk_triage',
    {
      title: 'Bulk Triage',
      description:
        'Resolve escalations for triage and start mcpTriage workflows. ' +
        'Each escalation is marked resolved with needsTriage=true, then ' +
        'a triage workflow is started to remediate the issue.',
      inputSchema: bulkTriageSchema,
    },
    async (args: z.infer<typeof bulkTriageSchema>) => {
      const resolved = await escalationService.bulkResolveForTriage(args.ids, args.hint);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            triaged: resolved.length,
            escalation_ids: resolved.map((e) => e.id),
          }),
        }],
      };
    },
  );

  // ── Metadata-based operations ───────────────────────────────────────────────

  // mirrors GET /api/escalations/by-metadata
  (server as any).registerTool(
    'find_by_metadata',
    {
      title: 'Find by Metadata',
      description:
        'Find escalations by a metadata key-value pair.',
      inputSchema: findByMetadataSchema,
    },
    async (args: z.infer<typeof findByMetadataSchema>) => {
      const result = await escalationMetaApi.findByMetadata(args, { userId: 'lt-system' });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/claim-by-metadata
  (server as any).registerTool(
    'claim_by_metadata',
    {
      title: 'Claim by Metadata',
      description:
        'Find and claim an escalation by metadata key-value pair.',
      inputSchema: claimByMetadataSchema,
    },
    async (args: z.infer<typeof claimByMetadataSchema>) => {
      const result = await escalationMetaApi.claimByMetadata(args, { userId: 'lt-system' });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/resolve-by-metadata
  (server as any).registerTool(
    'resolve_by_metadata',
    {
      title: 'Resolve by Metadata',
      description:
        'Find and resolve an escalation by metadata key-value pair.',
      inputSchema: resolveByMetadataSchema,
    },
    async (args: z.infer<typeof resolveByMetadataSchema>) => {
      const result = await escalationMetaApi.resolveByMetadata(args, { userId: 'lt-system' });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // ── Bulk operations ─────────────────────────────────────────────────────────

  // mirrors POST /api/escalations/bulk-claim
  (server as any).registerTool(
    'bulk_claim',
    {
      title: 'Bulk Claim',
      description: 'Claim multiple escalations in a single operation.',
      inputSchema: bulkClaimSchema,
    },
    async (args: z.infer<typeof bulkClaimSchema>) => {
      const result = await escalationBulkApi.bulkClaim(args, { userId: 'lt-system' });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/bulk-assign
  (server as any).registerTool(
    'bulk_assign',
    {
      title: 'Bulk Assign',
      description: 'Assign multiple escalations to a specific user.',
      inputSchema: bulkAssignSchema,
    },
    async (args: z.infer<typeof bulkAssignSchema>) => {
      const result = await escalationBulkApi.bulkAssign(args, { userId: 'lt-system' });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors PATCH /api/escalations/bulk-escalate
  (server as any).registerTool(
    'bulk_escalate',
    {
      title: 'Bulk Escalate',
      description: 'Escalate multiple escalations to a different role.',
      inputSchema: bulkEscalateSchema,
    },
    async (args: z.infer<typeof bulkEscalateSchema>) => {
      const result = await escalationBulkApi.bulkEscalate(args, { userId: 'lt-system' });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors PATCH /api/escalations/priority
  (server as any).registerTool(
    'update_priority',
    {
      title: 'Update Priority',
      description: 'Update the priority of multiple escalations.',
      inputSchema: updatePrioritySchema,
    },
    async (args: z.infer<typeof updatePrioritySchema>) => {
      const result = await escalationBulkApi.updatePriority(args, { userId: 'lt-system' });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
