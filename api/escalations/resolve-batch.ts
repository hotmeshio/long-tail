import * as escalationService from '../../services/escalation';
import { checkResolverPayload } from '../../services/escalation/resolver-validation';
import { getEnforcingRoles } from '../../services/role/enforcement-cache';
import { ESCALATION_BATCH_KEYS } from '../../types/escalation';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

import { assertReadAccess, assertWriteAccess, getEscalationWriteScope } from './helpers';
import { validationFailure, redactPasswords, resolverIdentity } from './resolve';
import { restrictScopeRoles } from './metadata';

/**
 * Submit ONE declared item of a batch escalation (a `conditional` wait created
 * with `batch: [...]`). Interim submissions are cheap atomic fills — the row
 * stays pending and `remaining` reports progress. The LAST item completes the
 * escalation: the row resolves and the waiting workflow wakes with the full
 * collection, in the same statement.
 *
 * Each item validates against the SAME versioned form schema a single-item
 * resolver gets (metadata.form_schema → pinned lt_role_schemas → live role
 * schema), including the submit guard.
 *
 * Claim semantics: claim-agnostic by default — a batch accumulates
 * contributions from multiple principals, so the single-owner claim lock is
 * not asserted (same rationale as resolve-by-signal-key). Pass
 * `assertClaim: true` to require the caller's own live claim, asserted
 * atomically inside the SDK's guarded statement.
 */
export async function resolveBatchItem(
  input: {
    id: string;
    itemKey: string;
    resolverPayload: Record<string, any>;
    metadata?: Record<string, any>;
    assertClaim?: boolean;
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, itemKey, resolverPayload, metadata } = input;
    if (!itemKey) return { status: 400, error: 'itemKey is required' };
    if (!resolverPayload) return { status: 400, error: 'resolverPayload is required' };

    const escalation = await escalationService.getEscalation(id);
    if (!escalation) return { status: 404, error: 'Escalation not found' };
    if (escalation.status === 'cancelled') return { status: 409, error: 'Escalation is cancelled' };
    if (escalation.status !== 'pending') return { status: 409, error: 'Escalation not available for resolution' };

    // Advisory shape gate — cheap, readable rejection. The SDK's guarded
    // statement re-checks and is the atomic arbiter (outcome 'not-batch').
    const pending = (escalation.metadata as any)?.[ESCALATION_BATCH_KEYS.PENDING];
    if (!Array.isArray(pending)) {
      return { status: 400, error: 'Escalation is not a batch' };
    }

    // Hybrid RBAC, identical to single-resolve: non-disclosure 404 for rows the
    // caller cannot see; informative 403 for rows they see but cannot act on.
    if (await assertReadAccess(auth.userId, escalation)) {
      return { status: 404, error: 'Escalation not found' };
    }
    const denied = await assertWriteAccess(auth.userId, escalation);
    if (denied) return denied;

    // Per-item schema enforcement — the exact validation path single-resolve
    // runs, against the row's pinned schema version.
    const violation = await checkResolverPayload(
      escalation, resolverPayload, undefined, auth.userId,
    );
    if (violation) return validationFailure(violation);

    const redacted = await redactPasswords(
      resolverPayload, (escalation.metadata as any)?.form_schema,
    );

    // resolved_by merges on every fill; the completing fill's stamp is the
    // resolution provenance, matching single-resolve. $resolution rides the
    // completing item's signal only.
    const result = await escalationService.resolveBatchItem(
      escalation.id,
      itemKey,
      redacted,
      { ...metadata, resolved_by: auth.userId },
      input.assertClaim ? auth.userId : undefined,
      await resolverIdentity(auth),
    );
    return batchOutcomeResult(result, itemKey, escalation.workflow_id);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Submit one batch item selecting the escalation by its `signal_key` — the
 * deterministic home signal id the waiting workflow parked on. For callers
 * that already own that identity (a child workflow calling home, a webhook),
 * so no UUID lookup and no facet duplication. Mirrors resolve-by-signal-key:
 * claim-agnostic, write-scope gated with 404 non-disclosure.
 */
export async function resolveBatchItemBySignalKey(
  input: {
    signalKey: string;
    itemKey: string;
    resolverPayload: Record<string, any>;
    metadata?: Record<string, any>;
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { signalKey, itemKey, resolverPayload, metadata } = input;
    if (!signalKey) return { status: 400, error: 'signalKey is required' };
    if (!itemKey) return { status: 400, error: 'itemKey is required' };
    if (!resolverPayload) return { status: 400, error: 'resolverPayload is required' };

    const escalation = await escalationService.getEscalationBySignalKey(signalKey);
    if (!escalation) return { status: 404, error: 'Escalation not found' };
    if (escalation.status !== 'pending') return { status: 409, error: 'Escalation not available for resolution' };

    const pending = (escalation.metadata as any)?.[ESCALATION_BATCH_KEYS.PENDING];
    if (!Array.isArray(pending)) {
      return { status: 400, error: 'Escalation is not a batch' };
    }

    // Write verb on a system ingress surface — scope-gate with non-disclosure.
    const denied = await assertWriteAccess(auth.userId, escalation);
    if (denied) return { status: 404, error: 'Escalation not found' };

    const violation = await checkResolverPayload(
      escalation, resolverPayload, undefined, auth.userId,
    );
    if (violation) return validationFailure(violation);

    const redacted = await redactPasswords(
      resolverPayload, (escalation.metadata as any)?.form_schema,
    );

    const result = await escalationService.resolveBatchItemBySignalKey(
      signalKey,
      itemKey,
      redacted,
      { ...metadata, resolved_by: auth.userId },
      await resolverIdentity(auth),
    );
    return batchOutcomeResult(result, itemKey, escalation.workflow_id);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Submit one batch item selecting the escalation by metadata facet — the
 * faceted sibling of {@link resolveBatchItem}, mirroring resolve-by-metadata.
 * RBAC folds into the SDK's atomic facet selection as a flat role filter
 * (write_all roles; self-scope members act on their items by id).
 *
 * Schema enforcement is two-phase when enforcing roles exist: the item's
 * schema is a function of the SELECTED row's role and version pin, so the row
 * is picked first (scoped, priority-ordered), validated, then filled by
 * asserted id — the SDK statement re-checks pending/batch state atomically,
 * and a row that went terminal between phases surfaces as a 409.
 */
export async function resolveBatchItemByMetadata(
  input: {
    key: string;
    value: string;
    itemKey: string;
    resolverPayload: Record<string, any>;
    metadata?: Record<string, any>;
    restrictRoles?: string[];
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { key, value, itemKey, resolverPayload, metadata } = input;
    if (!key || !value) return { status: 400, error: 'key and value are required' };
    if (!itemKey) return { status: 400, error: 'itemKey is required' };
    if (!resolverPayload) return { status: 400, error: 'resolverPayload is required' };

    const writeScope = await getEscalationWriteScope(auth.userId);
    const allowedRoles = restrictScopeRoles(
      writeScope.allRoles, writeScope.global, input.restrictRoles,
    );
    const resolvedBy = await resolverIdentity(auth);
    const outcome = { ...metadata, resolved_by: auth.userId };

    const enforcing = await getEnforcingRoles();
    if (enforcing.size === 0) {
      // Single atomic call — selection, fill, and (on the last item) the
      // resolve + wake all inside the SDK statement.
      const result = await escalationService.resolveBatchItemByMetadata(
        key, value, itemKey, resolverPayload, allowedRoles ?? undefined, outcome, resolvedBy,
      );
      return batchOutcomeResult(result, itemKey, result.escalation?.workflow_id ?? null);
    }

    // Phase 1: pick the row the fill would target (scoped, priority-ordered)
    // and validate against ITS schema when its role enforces. The role
    // restriction folds into the scoped query — never a client-side filter.
    const found = await escalationService.findByMetadata(
      key, value, 'pending', 1, 0,
      allowedRoles === null ? undefined : { allRoles: allowedRoles, meUserId: auth.userId },
    );
    const row = found.escalations[0];
    if (!row) return { status: 404, error: 'No pending escalation found for this metadata' };

    if (enforcing.has(row.role)) {
      const report = await checkResolverPayload(row, resolverPayload, undefined, auth.userId);
      if (report) return validationFailure(report);
    }

    // Phase 2: fill by asserted id. The SDK statement re-checks pending +
    // batch state; a row that went terminal between phases maps to 409.
    const redacted = await redactPasswords(resolverPayload, (row.metadata as any)?.form_schema);
    const result = await escalationService.resolveBatchItem(
      row.id, itemKey, redacted, outcome, undefined, resolvedBy,
    );
    if (result.outcome === 'not-found') {
      return { status: 409, error: 'A concurrent resolution is already in progress for this escalation' };
    }
    return batchOutcomeResult(result, itemKey, row.workflow_id);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Maps the SDK batch outcome vocabulary onto HTTP results. */
function batchOutcomeResult(
  result: escalationService.ResolveBatchItemOutcome,
  itemKey: string,
  workflowId: string | null,
): LTApiResult {
  switch (result.outcome) {
    case 'completed':
      return {
        status: 200,
        data: {
          outcome: 'completed',
          remaining: 0,
          signaled: !!result.escalation?.signal_key,
          escalationId: result.escalation?.id,
          workflowId,
        },
      };
    case 'accepted':
      return {
        status: 200,
        data: {
          outcome: 'accepted',
          remaining: result.remaining,
          escalationId: result.escalation?.id,
        },
      };
    case 'duplicate-item':
      return {
        status: 409,
        error: 'Batch item already submitted',
        data: { error: 'Batch item already submitted', itemKey },
      };
    case 'claimed-by-other':
      return { status: 409, error: 'Escalation is claimed by another user' };
    case 'claim-expired':
      return { status: 409, error: 'Your claim has expired — re-claim this escalation to resolve it' };
    case 'not-found':
      return { status: 404, error: 'Escalation not found' };
    case 'unknown-item':
      return { status: 400, error: 'itemKey is not in the declared batch' };
    case 'not-batch':
      return { status: 400, error: 'Escalation is not a batch' };
    default:
      // already-resolved / already-cancelled / already-expired
      return { status: 409, error: 'Escalation not available for resolution' };
  }
}
