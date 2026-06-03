import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { publishEscalationEvent } from '../../lib/events/publish';
import { getVisibleRoles, resolveAssignee } from './helpers';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

/**
 * Find escalations by a metadata key-value pair.
 *
 * Uses JSONB containment (`@>`) backed by a GIN index.
 * Results are RBAC-scoped to the caller's visible roles.
 *
 * @param input.key — metadata field name (e.g. `"orderId"`)
 * @param input.value — metadata field value (e.g. `"order-123"`)
 * @param input.status — optional status filter (e.g. `"pending"`)
 * @returns `{ status: 200, data: { escalations, total } }`
 */
export async function findByMetadata(
  input: { key: string; value: string; status?: string; limit?: number; offset?: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.key || !input.value) {
      return { status: 400, error: 'key and value are required' };
    }
    const result = await escalationService.findByMetadata(
      input.key, input.value, input.status, input.limit, input.offset,
    );
    // RBAC: scope to visible roles
    const visibleRoles = await getVisibleRoles(auth.userId);
    if (visibleRoles) {
      const roleSet = new Set(visibleRoles);
      result.escalations = result.escalations.filter(e => roleSet.has(e.role));
      result.total = result.escalations.length;
    }
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Claim an escalation by metadata key-value pair.
 *
 * Finds one available (pending + unassigned/expired) escalation matching
 * the metadata and claims it atomically. Optionally resolves an assignee
 * from an external_id.
 *
 * @param input.key — metadata field name
 * @param input.value — metadata field value
 * @param input.durationMinutes — claim duration (default 30)
 * @param input.assignee — optional external_id of the user to claim as
 * @returns `{ status: 200, data: { escalation, isExtension } }`
 */
export async function claimByMetadata(
  input: { key: string; value: string; durationMinutes?: number; assignee?: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.key || !input.value) {
      return { status: 400, error: 'key and value are required' };
    }

    const resolved = await resolveAssignee(input.assignee, auth);
    if ('error' in resolved) return resolved.error;
    const claimUserId = resolved.userId;

    // RBAC: find the candidate to check role membership before atomic claim
    const candidates = await escalationService.findByMetadata(input.key, input.value, 'pending', 1, 0);
    if (candidates.escalations.length === 0) {
      return { status: 404, error: 'No pending escalation found for this metadata' };
    }
    const candidate = candidates.escalations[0];

    const isSuperAdmin = await userService.isSuperAdmin(auth.userId);
    if (!isSuperAdmin) {
      const userHasRole = await userService.hasRole(claimUserId, candidate.role);
      if (!userHasRole) {
        return { status: 403, error: `User must have the "${candidate.role}" role to claim this escalation` };
      }
    }

    const result = await escalationService.claimByMetadata(
      input.key, input.value, claimUserId, input.durationMinutes,
    );
    if (!result) {
      return { status: 409, error: 'Escalation not available for claim' };
    }

    publishEscalationEvent({
      type: 'escalation.claimed',
      source: 'api',
      workflowId: result.escalation.workflow_id || '',
      workflowName: result.escalation.workflow_type || '',
      taskQueue: result.escalation.task_queue || '',
      escalationId: result.escalation.id,
      status: 'claimed',
      data: { assigned_to: claimUserId },
    });

    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Resolve an escalation by metadata key-value pair.
 *
 * Finds the pending escalation, auto-claims if unclaimed, then delegates
 * to the standard resolve logic (supports all 5 resolution paths).
 *
 * @param input.key — metadata field name
 * @param input.value — metadata field value
 * @param input.resolverPayload — resolution data for the workflow
 * @param input.assignee — optional external_id of the resolving user
 * @returns result from the standard resolve endpoint
 */
export async function resolveByMetadata(
  input: { key: string; value: string; resolverPayload: Record<string, any>; assignee?: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.key || !input.value) {
      return { status: 400, error: 'key and value are required' };
    }
    if (!input.resolverPayload) {
      return { status: 400, error: 'resolverPayload is required' };
    }

    const candidates = await escalationService.findByMetadata(input.key, input.value, 'pending', 1, 0);
    if (candidates.escalations.length === 0) {
      return { status: 404, error: 'No pending escalation found for this metadata' };
    }
    const escalation = candidates.escalations[0];

    const resolved = await resolveAssignee(input.assignee, auth);
    if ('error' in resolved) return resolved.error;
    const resolveUserId = resolved.userId;

    const isSuperAdmin = await userService.isSuperAdmin(auth.userId);
    if (!isSuperAdmin) {
      const userHasRole = await userService.hasRole(resolveUserId, escalation.role);
      if (!userHasRole) {
        return { status: 403, error: `User must have the "${escalation.role}" role` };
      }
    }

    // Auto-claim if unclaimed or expired
    const isClaimed = escalation.assigned_to &&
      escalation.assigned_until &&
      new Date(escalation.assigned_until) > new Date();
    if (!isClaimed) {
      await escalationService.claimEscalation(escalation.id, resolveUserId, 5);
    }

    // Delegate to the full resolve logic (handles all 5 resolution paths)
    const { resolveEscalation } = await import('./resolve');
    return resolveEscalation({ id: escalation.id, resolverPayload: input.resolverPayload }, auth);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
