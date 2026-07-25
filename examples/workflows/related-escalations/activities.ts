/**
 * Related Escalations activities — post-resolution processing.
 *
 * Inputs are payload-shaped (x-lt-bind has already mapped the flat form
 * submission into the nested resolver contract). `parseResolverPayload` runs
 * the Zod schema at the activity boundary so business logic works with a
 * checked, typed value.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../../../lib/db';
import * as escalationCrud from '../../../services/escalation/crud';
import { bulkAssignEscalationsByQuery } from '../../../services/escalation/bulk';
import { parseResolverPayload } from '../../../lib/typed-resolution';

import {
  RelOriginatorResolverV1Schema,
  RelReviewerResolverV1Schema,
  type RelOriginatorResolverV1,
  type RelReviewerResolverV1,
} from './forms';
import { REL_PLATE_ROLE } from './forms-walk';

export interface OriginatorOutcome {
  stage: 'originator';
  decision: 'Escalate' | 'Resolve';
  reason?: string;
  processedAt: string;
}

export interface ReviewerOutcome {
  stage: 'reviewer';
  outcome: 'Approve' | 'Reject';
  rationale?: string;
  processedAt: string;
}

export async function processOriginator(input: RelOriginatorResolverV1): Promise<OriginatorOutcome> {
  const result = parseResolverPayload(RelOriginatorResolverV1Schema, input);
  return {
    stage: 'originator',
    decision: result.decision,
    reason: result.reason,
    processedAt: new Date().toISOString(),
  };
}

export async function processReview(input: RelReviewerResolverV1): Promise<ReviewerOutcome> {
  const result = parseResolverPayload(RelReviewerResolverV1Schema, input);
  return {
    stage: 'reviewer',
    outcome: result.outcome,
    rationale: result.rationale,
    processedAt: new Date().toISOString(),
  };
}

/**
 * Resolve the UUID of an efficient conditionLT escalation from its signal key.
 * Returns null when the escalation is not found (e.g. the workflow was cancelled
 * before the row was written).
 */
export async function lookupEscalationId(signalKey: string): Promise<string | null> {
  const esc = await escalationCrud.getEscalationBySignalKey(signalKey);
  return esc?.id ?? null;
}

/**
 * Assign every plate in the walk to the walker — one atomic query-form bulk
 * claim (selection and claim in the same UPDATE, no search-then-assign
 * window). The walker's identity arrives from the walk-claim resolve via
 * `$resolution.resolvedBy`.
 */
export async function assignWalk(input: {
  originId: string;
  walker: string;
}): Promise<{ assigned: number }> {
  const { assigned } = await bulkAssignEscalationsByQuery(
    { role: REL_PLATE_ROLE, facets: { originId: input.originId } },
    input.walker,
    60,
  );
  return { assigned };
}

/**
 * Signal the parent orchestrator that a plate resolved — mirrors the
 * assembly-line `signalParent` activity. The parent collects every plate's
 * done-signal in one Promise.all fan-in alongside the closeout wait.
 */
export async function signalPlateDone(input: {
  parentWorkflowId: string;
  signalId: string;
  data: Record<string, unknown>;
}): Promise<void> {
  const client = new Durable.Client({ connection: getConnection() });
  const handle = await client.workflow.getHandle(
    'long-tail-examples',
    'relatedEscalationsWorkflow',
    input.parentWorkflowId,
  );
  // Plates resolve BEFORE the parent registers its plate-done fan-in (the
  // parent is still awaiting the closeout) — these are early signals by
  // design, so buffer them for the walk's whole lifetime, not the default
  // ten minutes.
  await handle.signal(input.signalId, input.data, '24h');
}
