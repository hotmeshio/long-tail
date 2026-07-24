/**
 * Related Escalations — the reference workflow for x-lt-embed widgets.
 *
 * Two roles demonstrate all three embed capabilities on the reviewer form:
 *
 *   rel-originator — first-stage queue: an operator processes items and
 *                    escalates ones that need manager sign-off.
 *
 *   rel-reviewer   — manager-review queue: the reviewer resolves the item
 *                    with context pulled from the originator queue inline:
 *
 *     x-lt-widget: "link"            → deep-link to the originator queue,
 *                                       pre-filtered to the same orderId.
 *     x-lt-widget: "escalation"      → the originating escalation embedded
 *                                       inline (its decision + reason visible
 *                                       without navigating away).
 *     x-lt-widget: "escalation-list" → live list of other pending originator
 *                                       items for the same customer.
 *
 * The form doctrine is the same as in acme-stations: facts first as a
 * dictionary, one explicit decision, linear reveals.
 */

import { z } from 'zod';

export const REL_ORIGINATOR_ROLE = 'rel-originator';
export const REL_REVIEWER_ROLE = 'rel-reviewer';

export const REL_ORIGINATOR_SCHEMA_VERSION = 1;
export const REL_REVIEWER_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Resolver contracts
// ─────────────────────────────────────────────────────────────────────────────

export const RelOriginatorResolverV1Schema = z.object({
  decision: z.enum(['Escalate', 'Resolve']),
  reason: z.string().optional(),
  notes: z.string().optional(),
});
export type RelOriginatorResolverV1 = z.infer<typeof RelOriginatorResolverV1Schema>;

export const RelReviewerResolverV1Schema = z.object({
  outcome: z.enum(['Approve', 'Reject']),
  rationale: z.string().optional(),
  notes: z.string().optional(),
});
export type RelReviewerResolverV1 = z.infer<typeof RelReviewerResolverV1Schema>;

// ─────────────────────────────────────────────────────────────────────────────
// Originator form — simple triage decision
// ─────────────────────────────────────────────────────────────────────────────

export const REL_ORIGINATOR_FORM_SCHEMA = {
  type: 'object',
  'x-lt-layout': 'two-column',
  'x-lt-section-options': {
    'The item': { display: 'dictionary', columns: 2 },
  },
  'x-lt-help': [
    '### Originator review',
    '',
    'Inspect the item and decide: resolve it directly or escalate to manager review.',
    '',
    'Pick **Escalate** when the item requires a manager decision (policy exceptions,',
    'high-value items, or anything outside standard tolerance).',
    '',
    'Pick **Resolve** for items that clear all standard checks.',
  ].join('\n'),
  'x-lt-order': ['orderId', 'customerId', 'amount', 'decision', 'reason', 'notes'],
  required: ['decision'],
  properties: {
    orderId: {
      type: 'string',
      title: 'Order ID',
      readOnly: true,
      default: '',
      'x-lt-section': 'The item',
      'x-lt-hide-if-empty': false,
      description: 'The order being processed',
    },
    customerId: {
      type: 'string',
      title: 'Customer',
      readOnly: true,
      default: '',
      'x-lt-section': 'The item',
      'x-lt-hide-if-empty': true,
      description: 'Customer account identifier',
    },
    amount: {
      type: 'string',
      title: 'Amount',
      readOnly: true,
      default: '',
      'x-lt-section': 'The item',
      'x-lt-hide-if-empty': true,
      description: 'Order value',
    },
    decision: {
      type: 'string',
      title: 'Decision',
      enum: ['Escalate', 'Resolve'],
      default: '',
      'x-lt-span': 2,
      'x-lt-section': 'The decision',
      description: 'Escalate for manager review; Resolve to close directly',
    },
    reason: {
      type: 'string',
      format: 'textarea',
      title: 'Reason for escalation',
      default: '',
      minLength: 10,
      maxLength: 500,
      'x-lt-span': 2,
      'x-lt-section': 'The decision',
      'x-lt-showIf': 'resolver.decision=Escalate',
      description: 'Describe why this item needs manager review',
    },
    notes: {
      type: 'string',
      format: 'textarea',
      title: 'Notes',
      default: '',
      maxLength: 300,
      'x-lt-span': 2,
      'x-lt-section': 'Sign-off',
      'x-lt-showIf': 'resolver.decision',
      description: 'Anything worth keeping in the audit trail',
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Reviewer form — manager decision with embedded context
// ─────────────────────────────────────────────────────────────────────────────
//
// This form uses all three x-lt-embed widgets to give the reviewer full context
// without requiring navigation away from the escalation:
//
//   1. A link widget pre-navigates to the originator queue filtered to this order.
//   2. An escalation widget embeds the originator escalation inline (shows the
//      operator's decision and reason from its resolver payload).
//   3. An escalation-list widget surfaces other pending originator items for
//      the same customer — context for systemic patterns.

export const REL_REVIEWER_FORM_SCHEMA = {
  type: 'object',
  'x-lt-layout': 'two-column',
  'x-lt-section-options': {
    'The item': { display: 'dictionary', columns: 2 },
  },
  'x-lt-help': [
    '### Manager review',
    '',
    'The originator operator escalated this item — review their decision below,',
    'then Approve or Reject.',
    '',
    '**Approve** closes the item and signals completion to the workflow.',
    '',
    '**Reject** sends the item back to the originator queue for reprocessing.',
    '',
    'The **Related** section gives you live context from the originator queue:',
    '- A link to the queue pre-filtered to this order',
    '- The operator escalation embedded inline (their decision and reason)',
    '- Other pending items from the same customer (for pattern awareness)',
  ].join('\n'),
  'x-lt-order': [
    'orderId', 'customerId', 'amount',
    'originator_queue_link',
    'originator_escalation',
    'sibling_items',
    'outcome',
    'rationale',
    'notes',
  ],
  required: ['outcome'],
  properties: {
    // ── Facts ──
    orderId: {
      type: 'string',
      title: 'Order ID',
      readOnly: true,
      default: '',
      'x-lt-section': 'The item',
      'x-lt-hide-if-empty': false,
      description: 'The order under review',
    },
    customerId: {
      type: 'string',
      title: 'Customer',
      readOnly: true,
      default: '',
      'x-lt-section': 'The item',
      'x-lt-hide-if-empty': true,
      description: 'Customer account identifier',
    },
    amount: {
      type: 'string',
      title: 'Amount',
      readOnly: true,
      default: '',
      'x-lt-section': 'The item',
      'x-lt-hide-if-empty': true,
      description: 'Order value',
    },

    // ── x-lt-widget: "link" ──
    // Deep-link to the originator queue, pre-filtered to this order.
    // The facets JSON must be URL-encoded in practice; here shown expanded.
    originator_queue_link: {
      type: 'string',
      readOnly: true,
      'x-lt-widget': 'link',
      'x-lt-href': '/escalations/available?role=rel-originator&facets={"orderId":"{{metadata.orderId}}"}',
      'x-lt-span': 2,
      'x-lt-section': 'Related',
      title: 'View originator queue for this order',
      description: 'Opens the originator queue pre-filtered to this order',
    },

    // ── x-lt-widget: "escalation" ──
    // Embeds the originating escalation — the operator's escalation whose ID
    // the workflow stores in metadata.parent_escalation_id. The x-lt-fields
    // surface the operator's decision and reason from its resolver payload.
    originator_escalation: {
      type: 'string',
      readOnly: true,
      'x-lt-widget': 'escalation',
      'x-lt-source': 'metadata.parent_escalation_id',
      'x-lt-fields': [
        { label: 'Operator decision', value: '{{resolver.decision}}' },
        { label: 'Reason', value: '{{resolver.reason}}' },
        { label: 'Notes', value: '{{resolver.notes}}' },
        { label: 'Escalated', value: '{{escalation.created_at}}', format: 'age' },
      ],
      'x-lt-span': 2,
      'x-lt-section': 'Related',
      title: 'Originating escalation',
      description: "The operator's escalation and their stated reason",
    },

    // ── x-lt-widget: "escalation-list" ──
    // Live list of other pending originator items for the same customer.
    // The customerId facet value is interpolated from the current escalation's
    // metadata at render time.
    sibling_items: {
      type: 'string',
      readOnly: true,
      'x-lt-widget': 'escalation-list',
      'x-lt-query': {
        role: 'rel-originator',
        facets: { customerId: '{{metadata.customerId}}' },
        status: 'pending',
        limit: 5,
      },
      'x-lt-columns': [
        { label: 'Order', value: '{{metadata.orderId}}' },
        { label: 'Amount', value: '{{metadata.amount}}' },
        { label: 'Age', value: '{{escalation.created_at}}', format: 'age' },
      ],
      'x-lt-span': 2,
      'x-lt-section': 'Related',
      title: 'Other pending items for this customer',
      description: 'Up to 5 items currently waiting in the originator queue',
    },

    // ── The decision ──
    outcome: {
      type: 'string',
      title: 'Outcome',
      enum: ['Approve', 'Reject'],
      default: '',
      'x-lt-span': 2,
      'x-lt-section': 'The decision',
      description: 'Approve to complete the item; Reject to return to the operator',
    },
    rationale: {
      type: 'string',
      format: 'textarea',
      title: 'Rationale',
      default: '',
      minLength: 10,
      maxLength: 500,
      'x-lt-span': 2,
      'x-lt-section': 'The decision',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Explain the rejection so the operator can reprocess correctly',
    },
    notes: {
      type: 'string',
      format: 'textarea',
      title: 'Notes',
      default: '',
      maxLength: 300,
      'x-lt-span': 2,
      'x-lt-section': 'Sign-off',
      'x-lt-showIf': 'resolver.outcome',
      description: 'Anything worth keeping in the audit trail',
    },
  },
} as const;
