/**
 * Shared types for the Long Tail example workflows.
 *
 * Envelope types define the API contract for starting workflows.
 * Resolver types define the payload shape for resolving escalations.
 * Per-workflow types are re-exported for convenience.
 */

// ── Envelope types (API input contracts) ────────────────────────
export type {
  ReviewContentEnvelopeData,
  VerifyDocumentEnvelopeData,
  ProcessClaimEnvelopeData,
  WorkflowEnvelopeMap,
  InvocableWorkflowType,
} from './envelopes';

export { ENVELOPE_TEMPLATES } from './envelopes';

// ── Resolver types (escalation resolution contracts) ────────────
export type {
  ResolverLTBlock,
  BaseResolverPayload,
  ReviewContentResolverPayload,
  ProcessClaimResolverPayload,
  VerifyDocumentResolverPayload,
} from './resolvers';

// ── Per-workflow types (re-exported for convenience) ────────────
export type {
  ReviewContentInput,
  ReviewAnalysis,
  ReviewContentReturnData,
  ReviewContentReturn,
  ReviewContentEscalationData,
  ReviewContentEscalation,
} from '../workflows/review-content/types';

export type {
  ClaimAnalysis,
  ProcessClaimReturnData,
  ProcessClaimReturn,
  ProcessClaimEscalationData,
  ProcessClaimEscalation,
} from '../workflows/process-claim/types';

export type {
  MemberInfo,
  VerifyDocumentReturnData,
  VerifyDocumentReturn,
  VerifyDocumentEscalationData,
  VerifyDocumentEscalation,
} from '../workflows/verify-document/types';
