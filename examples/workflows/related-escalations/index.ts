/**
 * Related Escalations — the reference workflow for x-lt-embed widgets.
 *
 * A two-stage review chain followed by a claimed walk — together the roles
 * exercise every embed capability, the ownership-scope query contract, and
 * resolution provenance.
 *
 *   Stage 1: rel-originator — processes the item and decides to Resolve or Escalate.
 *            A direct Resolve closes the workflow without a reviewer stage.
 *
 *   Stage 2: rel-reviewer — manager reviews the escalated item with full context:
 *            - x-lt-widget: "link"            → originator queue pre-filtered to this order
 *            - x-lt-widget: "escalation"      → the originating escalation embedded inline
 *            - x-lt-widget: "escalation-list" → sibling pending items for the same customer
 *
 *   Stage 3: the claimed walk (on Approve) — see forms-walk.ts:
 *            - rel-walker: resolving the walk claim IS the "start walk" button;
 *              the resolver's identity arrives via $resolution and the workflow
 *              bulk-assigns every plate to them in one atomic query-form claim
 *            - rel-plate: one row per plate, resolved inline via x-lt-actions
 *            - rel-closer: the closeout form embeds the walker's OWN plates
 *              (x-lt-query assigned: "me") with Bagged ✓ actions, and
 *              x-lt-submit-guard on the same query locks the submit until the
 *              walk drains
 *
 * The originator escalation ID (UUID) is retrieved via the lookupEscalationId
 * activity after Stage 1 resolves. It rides in the reviewer's metadata as
 * `parent_escalation_id`, which the escalation widget resolves via x-lt-source.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope, EscalationResolution } from '../../../types';
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
import {
  REL_WALKER_ROLE,
  REL_WALKER_SCHEMA_VERSION,
  REL_CLOSER_ROLE,
  REL_CLOSER_SCHEMA_VERSION,
  type RelWalkerResolverV1,
  type RelCloserResolverV1,
} from './forms-walk';
import type { PlateDone } from './plate-worker';

export { relPlateWorkflow } from './plate-worker';

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

  if (reviewerOutcome.outcome !== 'Approve') {
    return {
      type: 'return' as const,
      data: {
        orderId,
        customerId,
        originator: originatorOutcome,
        reviewer: reviewerOutcome,
        completed: false,
      },
    };
  }

  // ── Stage 3: the claimed walk ─────────────────────────────────────────────
  // The full journey: claim the walk (one submit) → every plate assigns to
  // the walker atomically → N inline Bagged ✓ clicks on the closeout form →
  // the guard unlocks → one final submit. Zero navigation.

  // Fan the plates out as child workflows — each child runs a single inline
  // conditionLT (its plate row commits in the child's Leg1) and signals back
  // when the plate resolves. Only the starts are awaited here; the lone-waiter-
  // per-child shape is the engine's fan-out contract for parallel waits.
  // `originId` is the walk's rendezvous facet — the closeout form's embed,
  // actions, and guard all query it.
  const units = ['PLATE-1', 'PLATE-2', 'PLATE-3'];
  for (const unit of units) {
    await Durable.workflow.startChild({
      workflowName: 'relPlateWorkflow',
      args: [
        {
          data: {
            orderId,
            customerId,
            unit,
            originId: ctx.workflowId,
            parentSignalId: `plate-done-${unit}-${ctx.workflowId}`,
            parentWorkflowId: ctx.workflowId,
          },
          metadata: { source: 'related-escalations', unit },
        },
      ],
      taskQueue: 'long-tail-examples',
      workflowId: `plate-${unit}-${ctx.workflowId}`,
      entity: 'relPlateWorkflow',
      signalIn: false,
    });
  }

  // Whoever resolves the walk claim owns the walk — their identity arrives
  // under the reserved $resolution key.
  const walkClaim = await conditionLT<RelWalkerResolverV1 & { $resolution?: EscalationResolution }>(
    `rel-walker-${ctx.workflowId}`,
    {
      role: REL_WALKER_ROLE,
      type: 'walk',
      subtype: 'claim',
      priority: 2,
      description: `Claim the walk — ${orderId} · ${units.length} plates`,
      workflowType: 'relatedEscalationsWorkflow',
      envelope: {
        source: 'related-escalations',
        formDefaults: { ...facts, notes: '' },
      },
      metadata: { ...facts, originId: ctx.workflowId },
      schemaVersion: REL_WALKER_SCHEMA_VERSION,
    },
  );

  if (walkClaim === null) {
    return { type: 'return' as const, data: { cancelled: true, stage: 'walk-claim' } };
  }
  if (walkClaim === false) {
    return { type: 'return' as const, data: { expired: true, stage: 'walk-claim' } };
  }

  // One atomic query-form bulk claim: every pending plate in this walk goes
  // to the walker — no search-then-assign window.
  const walker = walkClaim.$resolution?.resolvedBy;
  const { assignWalk } = Durable.workflow.proxyActivities<ActivitiesType>({ activities });
  const walkAssignment = walker
    ? await assignWalk({ originId: ctx.workflowId, walker })
    : { assigned: 0 };

  // The closeout form embeds the walker's own claimed plates (assigned: "me")
  // with inline Bagged ✓ actions; the submit-guard holds its resolve until the
  // SAME query drains. Each Bagged ✓ also completes that plate's child
  // workflow, whose done-signal buffers (the children signal with a long
  // expire) until the fan-in below registers.
  const closeout = await conditionLT<RelCloserResolverV1>(`rel-closer-${ctx.workflowId}`, {
    role: REL_CLOSER_ROLE,
    type: 'walk',
    subtype: 'closeout',
    priority: 2,
    description: `Close the walk — ${orderId}`,
    workflowType: 'relatedEscalationsWorkflow',
    envelope: {
      source: 'related-escalations',
      formDefaults: { ...facts, confirmed: false, notes: '' },
    },
    metadata: { ...facts, originId: ctx.workflowId },
    schemaVersion: REL_CLOSER_SCHEMA_VERSION,
  });

  if (closeout === null) {
    return { type: 'return' as const, data: { cancelled: true, stage: 'walk-closeout' } };
  }
  if (closeout === false) {
    return { type: 'return' as const, data: { expired: true, stage: 'walk-closeout' } };
  }

  // Canonical fan-in: collect every plate's done-signal in one Promise.all.
  // The guard makes this instant in practice (plates resolved before the
  // closeout unlocked); structurally the workflow cannot complete until every
  // plate resolved — the guard's durable backstop.
  const plates = await Promise.all(
    units.map((unit) =>
      Durable.workflow.condition<PlateDone>(`plate-done-${unit}-${ctx.workflowId}`),
    ),
  );

  return {
    type: 'return' as const,
    data: {
      orderId,
      customerId,
      originator: originatorOutcome,
      reviewer: reviewerOutcome,
      walk: {
        walker: walker ?? null,
        assigned: walkAssignment.assigned,
        plates,
        closeout: closeout.confirmed,
      },
      completed: true,
    },
  };
}
