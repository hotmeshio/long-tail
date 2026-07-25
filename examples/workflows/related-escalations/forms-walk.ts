/**
 * The claimed walk — stage 3 of the related-escalations reference workflow,
 * demonstrating the ownership-scope embed contract end to end:
 *
 *   rel-walker — the walk-claim queue. Resolving here IS the "start walk"
 *                button: the resolver's identity arrives on the workflow via
 *                `$resolution`, and the workflow assigns every plate in the
 *                walk to that person with one atomic query-form bulk claim.
 *
 *   rel-plate  — one row per plate. Resolved inline from the closeout form's
 *                embedded list via x-lt-actions ("Bagged ✓" fires a canned
 *                resolve through the standard endpoint — RBAC + validation
 *                apply exactly as the full form).
 *
 *   rel-closer — the walk closeout. Its form embeds the walker's own claimed
 *                plates (`assigned: "me"`), renders the Bagged ✓ action on
 *                each row, and holds the submit locked with x-lt-submit-guard
 *                on the SAME query until the last plate resolves.
 *
 * The three surfaces (list, actions, guard) share one query — including the
 * ownership scope — so the visible rows and the gate's count always agree.
 */

import { z } from 'zod';

export const REL_WALKER_ROLE = 'rel-walker';
export const REL_PLATE_ROLE = 'rel-plate';
export const REL_CLOSER_ROLE = 'rel-closer';

export const REL_WALKER_SCHEMA_VERSION = 1;
export const REL_PLATE_SCHEMA_VERSION = 1;
export const REL_CLOSER_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Resolver contracts
// ─────────────────────────────────────────────────────────────────────────────

export const RelWalkerResolverV1Schema = z.object({
  notes: z.string().optional(),
});
export type RelWalkerResolverV1 = z.infer<typeof RelWalkerResolverV1Schema>;

export const RelPlateResolverV1Schema = z.object({
  bagged: z.boolean(),
  notes: z.string().optional(),
});
export type RelPlateResolverV1 = z.infer<typeof RelPlateResolverV1Schema>;

export const RelCloserResolverV1Schema = z.object({
  confirmed: z.boolean(),
  notes: z.string().optional(),
});
export type RelCloserResolverV1 = z.infer<typeof RelCloserResolverV1Schema>;

// ─────────────────────────────────────────────────────────────────────────────
// Walk-claim form — resolving IS the "start walk" button
// ─────────────────────────────────────────────────────────────────────────────

export const REL_WALKER_FORM_SCHEMA = {
  type: 'object',
  'x-lt-layout': 'two-column',
  'x-lt-section-options': {
    'The walk': { display: 'dictionary', columns: 2 },
  },
  'x-lt-help': [
    '### Claim the walk',
    '',
    'Submitting this form starts the walk: every plate for this order is',
    'assigned to **you** in one atomic step, and the closeout appears in the',
    'Walk Closeout queue with your plates embedded.',
  ].join('\n'),
  'x-lt-order': ['orderId', 'customerId', 'notes'],
  properties: {
    orderId: {
      type: 'string',
      title: 'Order ID',
      readOnly: true,
      default: '',
      'x-lt-section': 'The walk',
      'x-lt-hide-if-empty': false,
      description: 'The order whose plates make up this walk',
    },
    customerId: {
      type: 'string',
      title: 'Customer',
      readOnly: true,
      default: '',
      'x-lt-section': 'The walk',
      'x-lt-hide-if-empty': true,
      description: 'Customer account identifier',
    },
    notes: {
      type: 'string',
      format: 'textarea',
      title: 'Notes',
      default: '',
      maxLength: 300,
      'x-lt-span': 2,
      'x-lt-section': 'Sign-off',
      description: 'Anything worth noting before you start',
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Plate form — the full-form path behind the inline Bagged ✓ action
// ─────────────────────────────────────────────────────────────────────────────

export const REL_PLATE_FORM_SCHEMA = {
  type: 'object',
  'x-lt-layout': 'two-column',
  'x-lt-section-options': {
    'The plate': { display: 'dictionary', columns: 2 },
  },
  'x-lt-help': [
    '### Bag the plate',
    '',
    'Confirm the plate is bagged. From the walk closeout this resolves with',
    'one inline **Bagged ✓** click; this form is the detail path for anything',
    'the inline action cannot express.',
  ].join('\n'),
  'x-lt-order': ['orderId', 'unit', 'bagged', 'notes'],
  required: ['bagged'],
  properties: {
    orderId: {
      type: 'string',
      title: 'Order ID',
      readOnly: true,
      default: '',
      'x-lt-section': 'The plate',
      'x-lt-hide-if-empty': false,
      description: 'The order this plate belongs to',
    },
    unit: {
      type: 'string',
      title: 'Plate',
      readOnly: true,
      default: '',
      'x-lt-section': 'The plate',
      'x-lt-hide-if-empty': true,
      description: 'The plate identifier within the walk',
    },
    bagged: {
      type: 'boolean',
      title: 'Bagged',
      default: true,
      'x-lt-span': 2,
      'x-lt-section': 'Confirm',
      description: 'The plate is bagged and labeled',
    },
    notes: {
      type: 'string',
      format: 'textarea',
      title: 'Notes',
      default: '',
      maxLength: 300,
      'x-lt-span': 2,
      'x-lt-section': 'Confirm',
      description: 'Only needed when something was off',
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Closeout form — assigned:"me" embed + x-lt-actions + x-lt-submit-guard,
// all three on ONE query so they can never disagree
// ─────────────────────────────────────────────────────────────────────────────

export const REL_CLOSER_FORM_SCHEMA = {
  type: 'object',
  'x-lt-layout': 'two-column',
  'x-lt-section-options': {
    'The walk': { display: 'dictionary', columns: 2 },
  },
  'x-lt-help': [
    '### Close the walk',
    '',
    'Your claimed plates are listed below — each **Bagged ✓** resolves that',
    'plate in place. The submit stays locked until the last plate is bagged;',
    'it unlocks the moment the list drains.',
  ].join('\n'),
  'x-lt-submit-guard': {
    query: {
      role: REL_PLATE_ROLE,
      facets: { originId: '{{metadata.originId}}' },
      assigned: 'me',
    },
    mustBeEmpty: true,
    message: '{{count}} plate(s) still pending — bag them before closing the walk.',
  },
  'x-lt-order': ['orderId', 'customerId', 'my_plates', 'confirmed', 'notes'],
  required: ['confirmed'],
  properties: {
    orderId: {
      type: 'string',
      title: 'Order ID',
      readOnly: true,
      default: '',
      'x-lt-section': 'The walk',
      'x-lt-hide-if-empty': false,
      description: 'The order whose walk is closing',
    },
    customerId: {
      type: 'string',
      title: 'Customer',
      readOnly: true,
      default: '',
      'x-lt-section': 'The walk',
      'x-lt-hide-if-empty': true,
      description: 'Customer account identifier',
    },
    my_plates: {
      type: 'string',
      readOnly: true,
      'x-lt-widget': 'escalation-list',
      'x-lt-query': {
        role: REL_PLATE_ROLE,
        facets: { originId: '{{metadata.originId}}' },
        assigned: 'me',
        limit: 10,
      },
      'x-lt-columns': [
        { label: 'Plate', value: '{{metadata.unit}}' },
        { label: 'Order', value: '{{metadata.orderId}}' },
        { label: 'Age', value: '{{escalation.created_at}}', format: 'age' },
      ],
      'x-lt-actions': [
        {
          label: 'Bagged ✓',
          resolverPayload: { bagged: true },
          confirm: 'Mark {{metadata.unit}} bagged?',
        },
      ],
      'x-lt-span': 2,
      'x-lt-section': 'Your plates',
      title: 'Plates in this walk',
      description: 'Claimed to you when you started the walk — bag each in place',
    },
    confirmed: {
      type: 'boolean',
      title: 'Walk complete',
      default: false,
      'x-lt-span': 2,
      'x-lt-section': 'Sign-off',
      description: 'Every plate is bagged and the cart is back at the station',
    },
    notes: {
      type: 'string',
      format: 'textarea',
      title: 'Notes',
      default: '',
      maxLength: 300,
      'x-lt-span': 2,
      'x-lt-section': 'Sign-off',
      description: 'Anything worth keeping in the audit trail',
    },
  },
} as const;
