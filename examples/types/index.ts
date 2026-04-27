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
  KitchenSinkEnvelopeData,
  BasicEchoEnvelopeData,
  BasicSignalEnvelopeData,
  AssemblyLineEnvelopeData,
  StepIteratorEnvelopeData,
  ReverterEnvelopeData,
  WorkflowEnvelopeMap,
  InvocableWorkflowType,
} from './envelopes';

// ── Resolver types (escalation resolution contracts) ────────────
export type {
  ResolverLTBlock,
  BaseResolverPayload,
  ReviewContentResolverPayload,
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
