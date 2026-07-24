/**
 * Related Escalations — the reference workflow for x-lt-embed widgets.
 *
 * Two roles demonstrate a two-stage review chain where the reviewer form
 * surfaces context from the originator queue using all three embed widgets.
 *
 *   Stage 1: rel-originator — processes the item and decides to Resolve or Escalate.
 *            A direct Resolve closes the workflow without a reviewer stage.
 *
 *   Stage 2: rel-reviewer — manager reviews the escalated item with full context:
 *            - x-lt-widget: "link"            → originator queue pre-filtered to this order
 *            - x-lt-widget: "escalation"      → the originating escalation embedded inline
 *            - x-lt-widget: "escalation-list" → sibling pending items for the same customer
 *
 * The originator escalation ID (UUID) is retrieved via the lookupEscalationId
 * activity after Stage 1 resolves. It rides in the reviewer's metadata as
 * `parent_escalation_id`, which the escalation widget resolves via x-lt-source.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import {
  REL_ORIGINATOR_ROLE,
  REL_ORIGINATOR_SCHEMA_VERSION,
  REL_REVIEWER_ROLE,
  REL_REVIEWER_SCHEMA_VERSION,
  type RelOriginatorResolverV1,
  type RelReviewerResolverV1,
} from './forms';

type ActivitiesType = typeof activities;

export interface RelatedEscalationsEnvelopeData {
  orderId?: string;
  customerId?: string;
  amount?: string;
}

export async function relatedEscalationsWorkflow(envelope: LTEnvelope): Promise<any> {
  const {
    orderId = 'ORD-0001',
    customerId = 'CUST-0001',
    amount = '0.00',
  } = (envelope.data ?? {}) as RelatedEscalationsEnvelopeData;

  const { processOriginator, processReview, lookupEscalationId } =
    Durable.workflow.proxyActivities<ActivitiesType>({ activities });

  const ctx = Durable.workflow.workflowInfo();

  const facts = { orderId, customerId, amount };

  // ── Stage 1: Originator ───────────────────────────────────────────────────
  const originatorSignalId = `rel-originator-${ctx.workflowId}`;

  const originatorResult = await conditionLT<RelOriginatorResolverV1>(originatorSignalId, {
    role: REL_ORIGINATOR_ROLE,
    type: 'review',
    subtype: 'originator',
    priority: 2,
    description: `Order review — ${orderId} · ${customerId}`,
    workflowType: 'relatedEscalationsWorkflow',
    envelope: {
      source: 'related-escalations',
      formDefaults: { ...facts, decision: '', reason: '', notes: '' },
    },
    metadata: { ...facts },
    schemaVersion: REL_ORIGINATOR_SCHEMA_VERSION,
  });

  if (originatorResult === null) {
    return { type: 'return' as const, data: { cancelled: true, stage: 'originator' } };
  }
  if (originatorResult === false) {
    return { type: 'return' as const, data: { expired: true, stage: 'originator' } };
  }

  const originatorOutcome = await processOriginator(originatorResult);

  if (originatorOutcome.decision === 'Resolve') {
    return { type: 'return' as const, data: { ...originatorOutcome, completed: true } };
  }

  // ── Look up originator escalation UUID ──────────────────────────────────
  // The UUID rides in the reviewer's metadata so the escalation widget can
  // embed the originator card via x-lt-source: "metadata.parent_escalation_id".
  const parentEscalationId = await lookupEscalationId(originatorSignalId);

  // ── Stage 2: Reviewer ─────────────────────────────────────────────────────
  const reviewerResult = await conditionLT<RelReviewerResolverV1>(
    `rel-reviewer-${ctx.workflowId}`,
    {
      role: REL_REVIEWER_ROLE,
      type: 'review',
      subtype: 'manager',
      priority: 1,
      description: `Manager review — ${orderId} · ${customerId}`,
      workflowType: 'relatedEscalationsWorkflow',
      envelope: {
        source: 'related-escalations',
        formDefaults: { ...facts, outcome: '', rationale: '', notes: '' },
      },
      metadata: {
        ...facts,
        // Picked up by x-lt-source: "metadata.parent_escalation_id" on the
        // originator_escalation field in REL_REVIEWER_FORM_SCHEMA.
        ...(parentEscalationId ? { parent_escalation_id: parentEscalationId } : {}),
      },
      schemaVersion: REL_REVIEWER_SCHEMA_VERSION,
    },
  );

  if (reviewerResult === null) {
    return { type: 'return' as const, data: { cancelled: true, stage: 'reviewer' } };
  }
  if (reviewerResult === false) {
    return { type: 'return' as const, data: { expired: true, stage: 'reviewer' } };
  }

  const reviewerOutcome = await processReview(reviewerResult);

  return {
    type: 'return' as const,
    data: {
      orderId,
      customerId,
      originator: originatorOutcome,
      reviewer: reviewerOutcome,
      completed: reviewerOutcome.outcome === 'Approve',
    },
  };
}
