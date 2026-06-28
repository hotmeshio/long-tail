import * as escalationService from '../../services/escalation';
import {
  getEscalationReadScope,
  getEscalationWriteScope,
  resolveAssignee,
  type ProvisionIfAbsent,
} from './helpers';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

/**
 * Find escalations by a metadata key-value pair.
 *
 * Single query with window function for count. Results are
 * RBAC-scoped to the caller's visible roles.
 */
export async function findByMetadata(
  input: { key: string; value: string; status?: string; limit?: number; offset?: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.key || !input.value) {
      return { status: 400, error: 'key and value are required' };
    }
    // RBAC scoped IN SQL: the caller's read scope (read_all roles see every match;
    // read_self roles see only matches assigned to them) reaches the scoped query's
    // WHERE and COUNT. Global access → no filter. Never filter a fetched page
    // controller-side — that shrinks the page and reports a wrong total.
    const scope = await getEscalationReadScope(auth.userId);
    const result = await escalationService.findByMetadata(
      input.key, input.value, input.status, input.limit, input.offset,
      scope.global
        ? undefined
        : { allRoles: scope.allRoles, selfRoles: scope.selfRoles, meUserId: auth.userId },
    );
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Claim an escalation by metadata key-value pair.
 *
 * Single atomic query. RBAC is enforced in the SQL WHERE clause —
 * if the caller doesn't have an allowed role, zero rows match and
 * the claim never happens. No pre-flight find, no TOCTOU.
 */
export async function claimByMetadata(
  input: { key: string; value: string; durationMinutes?: number; assignee?: string; metadata?: Record<string, any>; provisionIfAbsent?: ProvisionIfAbsent },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.key || !input.value) {
      return { status: 400, error: 'key and value are required' };
    }

    const resolved = await resolveAssignee(input.assignee, auth, input.provisionIfAbsent);
    if ('error' in resolved) return resolved.error;
    const claimUserId = resolved.userId;

    // Write-scope: global → no filter; otherwise restrict to write_all roles. The
    // SDK claim-by-metadata uses a flat role filter and cannot enforce write_self
    // ownership, so self-scope members are excluded from this path (their items
    // are pre-claimed and acted on by id).
    const writeScope = await getEscalationWriteScope(auth.userId);
    const allowedRoles = writeScope.global ? null : writeScope.allRoles;

    const result = await escalationService.claimByMetadata(
      input.key, input.value, claimUserId, input.durationMinutes,
      input.metadata, allowedRoles,
    );

    if (!result) {
      // No rows matched. Check if candidates existed (role mismatch vs no match).
      return { status: 404, error: 'No pending escalation found for this metadata' };
    }

    if (result.candidatesExist > 0 && !result.escalation) {
      return { status: 403, error: 'Escalation exists but your roles do not permit claiming it' };
    }

    return { status: 200, data: { escalation: result.escalation, isExtension: result.isExtension } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Resolve an escalation by metadata key-value pair.
 *
 * Single atomic query with signal guard:
 * - No signal_id → claim + resolve atomically in SQL. One query. Done.
 * - signal_id present → SQL returns the signal info without resolving.
 *   Caller signals the workflow; conditionLT resolves durably inside
 *   the workflow via ltResolveEscalation.
 *
 * Never does SELECT-then-UPDATE. The SQL CTE handles find + RBAC +
 * claim + resolve (or signal detection) in one round-trip.
 */
export async function resolveByMetadata(
  input: { key: string; value: string; resolverPayload: Record<string, any>; assignee?: string; metadata?: Record<string, any> },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.key || !input.value) {
      return { status: 400, error: 'key and value are required' };
    }
    if (!input.resolverPayload) {
      return { status: 400, error: 'resolverPayload is required' };
    }

    const resolved = await resolveAssignee(input.assignee, auth);
    if ('error' in resolved) return resolved.error;
    const resolveUserId = resolved.userId;

    // Write-scope folds into the atomic resolve SQL: global → no filter; otherwise
    // write_all roles match any item, write_self roles match only items assigned
    // to the resolver. A non-global caller cannot pass a foreign assignee, so the
    // self-branch (assigned_to = resolveUserId) is the caller's own items.
    const writeScope = await getEscalationWriteScope(auth.userId);
    const writeAllRoles = writeScope.global ? null : writeScope.allRoles;
    const writeSelfRoles = writeScope.global ? null : writeScope.selfRoles;

    const result = await escalationService.resolveByMetadataAtomic(
      input.key, input.value, resolveUserId,
      input.resolverPayload, input.metadata, writeAllRoles, writeSelfRoles,
    );

    if (result.outcome === 'not_found') {
      return { status: 404, error: 'No pending escalation found for this metadata, or insufficient role permissions' };
    }

    if (result.outcome === 'conflict') {
      return { status: 409, error: 'A concurrent resolution is already in progress for this escalation' };
    }

    if (result.outcome === 'resolved') {
      return { status: 200, data: { escalation: result.escalation } };
    }

    // Atomic conditionLT escalation (signal_key set) — SDK resolve atomically marks
    // resolved AND delivers the signal to the waiting condition(), resuming the workflow.
    if (result.signalKey) {
      const resolved = await escalationService.resolveEscalation(result.escalationId!, input.resolverPayload);
      if (!resolved) {
        return { status: 409, error: 'Escalation not available for resolution' };
      }
      return {
        status: 200,
        data: { signaled: true, escalationId: result.escalationId, workflowId: result.workflowId },
      };
    }

    // Legacy conditionLT escalation (metadata.signal_id set) — signal the workflow,
    // conditionLT interceptor resolves durably via ltResolveEscalation.
    const { createClient } = await import('../../workers');
    const client = createClient();
    const handle = await client.workflow.getHandle(
      result.taskQueue!,
      result.workflowType!,
      result.workflowId!,
    );
    await handle.signal(result.signalId!, {
      ...input.resolverPayload,
      $escalation_id: result.escalationId,
    });

    return {
      status: 200,
      data: { signaled: true, escalationId: result.escalationId, workflowId: result.workflowId },
    };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

