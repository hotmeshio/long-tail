/**
 * Escalation tools — mirrors routes/escalations/
 *
 * Every tool runs as the `lt-system` bot. The escalation RBAC helpers
 * (getVisibleRoles / getUserRoles / hasGlobalEscalationAccess) query a uuid
 * column, so the bot's external_id string ('lt-system') would blow up with
 * `invalid input syntax for type uuid`. `systemAuth()` resolves the bot's real
 * UUID once and caches it; that UUID (a superadmin) is passed as the principal.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as escalationService from '../../../services/escalation';
import * as escalationApi from '../../../api/escalations';
import * as escalationMetaApi from '../../../api/escalations/metadata';
import * as escalationBulkApi from '../../../api/escalations/bulk';
import { ensureSystemBot } from '../../../services/iam';
import type { LTApiAuth } from '../../../types/sdk';
import {
  findEscalationsSchema,
  getEscalationSchema,
  getEscalationsByWorkflowSchema,
  getEscalationStatsSchema,
  claimEscalationSchema,
  releaseEscalationSchema,
  resolveEscalationSchema,
  cancelEscalationSchema,
  bulkCancelSchema,
  escalateEscalationSchema,
  resolveBySignalKeySchema,
  releaseExpiredClaimsSchema,
  bulkTriageSchema,
  findByMetadataSchema,
  claimByMetadataSchema,
  resolveByMetadataSchema,
  bulkClaimSchema,
  bulkAssignSchema,
  bulkEscalateSchema,
  updatePrioritySchema,
  resolveByIdsSchema,
  searchByFacetsSchema,
  claimGroupsSchema,
  claimByFacetsSchema,
} from './schemas';

let systemPrincipalId: string | null = null;

/**
 * Resolve (and cache) the lt-system bot's real UUID. The escalation RBAC helpers
 * query the uuid `user_id` column, so the external_id string 'lt-system' would
 * raise `invalid input syntax for type uuid`. The bot is a superadmin, so it has
 * global escalation access.
 */
async function systemAuth(): Promise<LTApiAuth> {
  if (!systemPrincipalId) systemPrincipalId = await ensureSystemBot();
  return { userId: systemPrincipalId, role: 'superadmin' };
}

/** Project the full escalation record to the MCP-facing shape, including metadata. */
function projectEscalation(e: any) {
  return {
    id: e.id,
    type: e.type,
    subtype: e.subtype,
    role: e.role,
    priority: e.priority,
    status: e.status,
    description: e.description,
    workflow_id: e.workflow_id,
    workflow_type: e.workflow_type,
    assigned_to: e.assigned_to,
    assigned_until: e.assigned_until,
    signal_key: e.signal_key,
    metadata: e.metadata,
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}

export function registerEscalationTools(server: McpServer): void {

  // ── Read-only ───────────────────────────────────────────────────────────────

  // mirrors GET /api/escalations
  (server as any).registerTool(
    'find_escalations',
    {
      title: 'Find Escalations',
      description:
        'Search escalations with optional filters (status, role, type, subtype, ' +
        'assigned_to, priority), correlation-id `search`, and sorting. `search` is an ' +
        'exact-match lookup by escalation id, workflow id, or origin id (order/ticket) — ' +
        'index-served over the full result set. To match a value INSIDE metadata ' +
        '(e.g. an order id), use the FACETED metadata query — `facets` (metadata @> containment), ' +
        '`block` (exclusion), `range` (numeric), `exists` (key present), `roles`, `available`, and ' +
        '`orderBy` (incl. metadata.<key>) — all role-scoped, GIN-served, and status-agnostic ' +
        '(no status filter required). Returns full records including metadata, workflow linkage, ' +
        'assignment, and signal_key.',
      inputSchema: findEscalationsSchema,
    },
    async (args: z.infer<typeof findEscalationsSchema>) => {
      const result = await escalationApi.listEscalations(
        {
          status: args.status,
          role: args.role,
          type: args.type,
          subtype: args.subtype,
          assigned_to: args.assigned_to,
          search: args.search,
          priority: args.priority,
          limit: args.limit,
          offset: args.offset,
          sort_by: args.sort_by,
          order: args.order,
          // Faceted metadata query (composes with role-scope in SQL).
          roles: args.roles,
          facets: args.facets,
          block: args.block,
          range: args.range,
          exists: args.exists,
          available: args.available,
          orderBy: args.orderBy,
        },
        await systemAuth(),
      );
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      const { escalations, total } = result.data as { escalations: any[]; total: number };
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total,
            count: escalations.length,
            escalations: escalations.map(projectEscalation),
          }),
        }],
      };
    },
  );

  // mirrors GET /api/escalations/:id
  (server as any).registerTool(
    'get_escalation',
    {
      title: 'Get Escalation',
      description:
        'Get a single escalation by ID — the full record including metadata, envelope ' +
        'linkage, resolver/escalation payloads, signal_key, and assignment state.',
      inputSchema: getEscalationSchema,
    },
    async (args: z.infer<typeof getEscalationSchema>) => {
      const result = await escalationApi.getEscalation({ id: args.id }, await systemAuth());
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/escalations/by-workflow/:workflowId
  (server as any).registerTool(
    'get_escalations_by_workflow',
    {
      title: 'Get Escalations by Workflow',
      description:
        'List all escalations linked to a specific workflow ID, newest first. Returns ' +
        'full records including metadata.',
      inputSchema: getEscalationsByWorkflowSchema,
    },
    async (args: z.infer<typeof getEscalationsByWorkflowSchema>) => {
      const result = await escalationApi.getEscalationsByWorkflowId({ workflowId: args.workflow_id });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
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
        content: [{ type: 'text' as const, text: JSON.stringify(stats) }],
      };
    },
  );

  // mirrors GET /api/escalations/by-metadata
  (server as any).registerTool(
    'find_by_metadata',
    {
      title: 'Find by Metadata',
      description:
        'Find escalations by a metadata key-value pair (e.g. a correlation key written ' +
        'into metadata when the escalation was raised).',
      inputSchema: findByMetadataSchema,
    },
    async (args: z.infer<typeof findByMetadataSchema>) => {
      const result = await escalationMetaApi.findByMetadata(args, await systemAuth());
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // ── Read-write ────────────────────────────────────────────────────────────────

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
      const result = await escalationApi.claimEscalation(
        { id: args.id, durationMinutes: args.duration_minutes },
        await systemAuth(),
      );
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/:id/release
  (server as any).registerTool(
    'release_escalation',
    {
      title: 'Release Escalation',
      description:
        'Release a claimed escalation back to the available pool. Reverses a ' +
        'claim_escalation so another holder can pick it up.',
      inputSchema: releaseEscalationSchema,
    },
    async (args: z.infer<typeof releaseEscalationSchema>) => {
      const result = await escalationApi.releaseEscalation({ id: args.id }, await systemAuth());
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/:id/resolve
  (server as any).registerTool(
    'resolve_escalation',
    {
      title: 'Resolve Escalation',
      description:
        'Resolve a pending escalation with a human-provided payload. Routes by escalation ' +
        'shape: efficient (signal_key) escalations resume the waiting workflow in place; ' +
        'legacy paths signal via routing metadata or re-run the original workflow. ' +
        'Password fields in the payload are replaced with ephemeral tokens.',
      inputSchema: resolveEscalationSchema,
    },
    async (args: z.infer<typeof resolveEscalationSchema>) => {
      const result = await escalationApi.resolveEscalation(
        { id: args.id, resolverPayload: args.resolverPayload },
        await systemAuth(),
      );
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/resolve-by-signal-key
  (server as any).registerTool(
    'resolve_by_signal_key',
    {
      title: 'Resolve by Signal Key',
      description:
        'Resolve an efficient (atomic) escalation directly by its signal_key and resume the ' +
        'waiting workflow in place. For callers that know the deterministic signal id and want ' +
        'to skip the id lookup.',
      inputSchema: resolveBySignalKeySchema,
    },
    async (args: z.infer<typeof resolveBySignalKeySchema>) => {
      const result = await escalationApi.resolveBySignalKey(
        { signalKey: args.signalKey, resolverPayload: args.resolverPayload },
        await systemAuth(),
      );
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/resolve-by-ids
  (server as any).registerTool(
    'resolve_by_ids',
    {
      title: 'Resolve by IDs',
      description:
        'Resolve a SET of escalations by id in one guarded statement. RBAC-scoped: ' +
        'callers may only resolve rows whose role they hold. For bookkeeping rows woken ' +
        'collectively (no per-row signal delivery).',
      inputSchema: resolveByIdsSchema,
    },
    async (args: z.infer<typeof resolveByIdsSchema>) => {
      const result = await escalationApi.resolveByIds(
        { ids: args.ids, resolverPayload: args.resolverPayload, metadata: args.metadata },
        await systemAuth(),
      );
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/search-by-facets
  (server as any).registerTool(
    'search_by_facets',
    {
      title: 'Search by Facets',
      description:
        'Faceted search over a pond, scoped to the caller\'s role. Filter by status, ' +
        'availability, and metadata facets; sort by columns; page with limit/offset.',
      inputSchema: searchByFacetsSchema,
    },
    async (args: z.infer<typeof searchByFacetsSchema>) => {
      const result = await escalationApi.searchByFacets(args as any, await systemAuth());
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/claim-groups
  (server as any).registerTool(
    'claim_groups',
    {
      title: 'Claim Groups',
      description:
        'Batch-claim complete origin groups (orders) in priority order over a pond, ' +
        'assigned to the calling principal. RBAC-scoped to the pond role.',
      inputSchema: claimGroupsSchema,
    },
    async (args: z.infer<typeof claimGroupsSchema>) => {
      const result = await escalationApi.claimGroups(
        { query: args.query as any, limit: args.limit, durationMinutes: args.durationMinutes, sizeFacet: args.sizeFacet },
        await systemAuth(),
      );
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/claim-by-facets
  (server as any).registerTool(
    'claim_by_facets',
    {
      title: 'Claim by Facets',
      description:
        'Batch-claim individual rows matching a facet query (FOR UPDATE SKIP LOCKED), ' +
        'assigned to the calling principal. With allOrNone, commits only the full set. ' +
        'RBAC-scoped to the pond role.',
      inputSchema: claimByFacetsSchema,
    },
    async (args: z.infer<typeof claimByFacetsSchema>) => {
      const result = await escalationApi.claimByFacets(
        { query: args.query as any, limit: args.limit, durationMinutes: args.durationMinutes, allOrNone: args.allOrNone },
        await systemAuth(),
      );
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors PATCH /api/escalations/:id/escalate
  (server as any).registerTool(
    'escalate_escalation',
    {
      title: 'Escalate Escalation',
      description:
        'Route a pending escalation to a different role (per the escalation chain). The new ' +
        'role becomes responsible for resolving it.',
      inputSchema: escalateEscalationSchema,
    },
    async (args: z.infer<typeof escalateEscalationSchema>) => {
      const result = await escalationApi.escalateToRole(
        { id: args.id, targetRole: args.targetRole },
        await systemAuth(),
      );
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/:id/cancel
  (server as any).registerTool(
    'cancel_escalation',
    {
      title: 'Cancel Escalation',
      description:
        'Permanently cancel a pending escalation — used when the tied workflow has ' +
        'terminated and can never receive the resolution signal. Preserved for audit.',
      inputSchema: cancelEscalationSchema,
    },
    async (args: z.infer<typeof cancelEscalationSchema>) => {
      const result = await escalationApi.cancelSingleEscalation({ id: args.id }, await systemAuth());
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
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
      const result = await escalationMetaApi.claimByMetadata(args, await systemAuth());
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
      const result = await escalationMetaApi.resolveByMetadata(args, await systemAuth());
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
      const result = await escalationBulkApi.bulkClaim(args, await systemAuth());
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
      const result = await escalationBulkApi.bulkAssign(args, await systemAuth());
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
      const result = await escalationBulkApi.bulkEscalate(args, await systemAuth());
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/escalations/bulk-cancel
  (server as any).registerTool(
    'bulk_cancel',
    {
      title: 'Bulk Cancel',
      description: 'Cancel multiple pending escalations in a single operation.',
      inputSchema: bulkCancelSchema,
    },
    async (args: z.infer<typeof bulkCancelSchema>) => {
      const result = await escalationApi.bulkCancel(args, await systemAuth());
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
      const result = await escalationBulkApi.updatePriority(args, await systemAuth());
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
