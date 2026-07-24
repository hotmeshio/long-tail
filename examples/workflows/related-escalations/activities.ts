/**
 * Related Escalations activities — post-resolution processing.
 *
 * Inputs are payload-shaped (x-lt-bind has already mapped the flat form
 * submission into the nested resolver contract). `parseResolverPayload` runs
 * the Zod schema at the activity boundary so business logic works with a
 * checked, typed value.
 */

import * as escalationCrud from '../../../services/escalation/crud';
import { parseResolverPayload } from '../../../lib/typed-resolution';

import {
  RelOriginatorResolverV1Schema,
  RelReviewerResolverV1Schema,
  type RelOriginatorResolverV1,
  type RelReviewerResolverV1,
} from './forms';

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
