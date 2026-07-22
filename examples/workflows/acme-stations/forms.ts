/**
 * Acme station interfaces — the reference "perfect form" pair. Two roles own
 * versioned escalation forms for one manufacturing order flow:
 *
 *   acme-addons    — extrinsic work attached after printing (the custom-work
 *                    checklist is the centerpiece: named per order, clickable)
 *   acme-print-qa  — post-print inspection (the fixed review ritual and the
 *                    rejection report)
 *
 * The form doctrine both schemas follow:
 *   - Facts first, as a dense dictionary (`x-lt-section-options` display) —
 *     the work ticket, not form rows.
 *   - ONE explicit decision: an enum that opens on "Choose…" — nothing below
 *     it renders until the resolver decides. No bare checkboxes for decisions.
 *   - Linear reveals: each outcome fades in exactly the section it needs
 *     (`x-lt-showIf` value matches on `resolver.outcome`), so the connection
 *     between the choice and what appears is visible in time.
 *   - Every input carries a `title` and one instructional `description` line.
 *     The WHY lives in `x-lt-help` (the side panel); the form says what to do.
 *   - Common checklist items arrive pre-checked (formDefaults); the custom,
 *     per-order work arrives unchecked — those are the clicks that matter.
 *   - Sign-off last. Required fields enforce themselves only while visible.
 */

import { z } from 'zod';

export const ACME_ADDONS_ROLE = 'acme-addons';
export const ACME_QA_ROLE = 'acme-print-qa';

/** Form versions the workflow is written against (pinned via schemaVersion). */
export const ACME_ADDONS_SCHEMA_VERSION = 1;
export const ACME_QA_SCHEMA_VERSION = 1;

/** One checklist entry as the dashboard's checklist widget consumes it. */
export interface AcmeChecklistItem {
  id: string;
  label: string;
  required?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolver contracts — the nested payload each stage receives back.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hidden conditional fields still ride the submission carrying their defaults
 * ('' for untouched text and checklists, [''] for an empty upload slot). The
 * contract treats empty as absent, so a Complete submission's hollow report
 * parses clean and a Reject submission's filled report comes through typed.
 */
const absentWhenEmpty = <T extends z.ZodTypeAny>(inner: T): z.ZodType<z.output<T> | undefined> =>
  z.preprocess((v) => (v === '' ? undefined : v), inner.optional()) as unknown as z.ZodType<z.output<T> | undefined>;

const reportSchema = z.object({
  reasons: absentWhenEmpty(z.record(z.boolean())),
  reason: absentWhenEmpty(z.string()),
  left: z.number().optional(),
  right: z.number().optional(),
  sendBackTo: absentWhenEmpty(z.string()),
  photos: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter(Boolean) : v),
    z.array(z.string()).optional(),
  ) as unknown as z.ZodType<string[] | undefined>,
});

export const AcmeAddonsResolverV1Schema = z.object({
  outcome: z.enum(['Complete', 'Reject']),
  checks: z.record(z.boolean()).optional(),
  customChecks: z.record(z.boolean()).optional(),
  report: reportSchema.optional(),
  notes: z.string().optional(),
});
export type AcmeAddonsResolverV1 = z.infer<typeof AcmeAddonsResolverV1Schema>;

export const AcmeQaResolverV1Schema = z.object({
  outcome: z.enum(['Pass', 'Reject']),
  checks: z.record(z.boolean()).optional(),
  report: reportSchema.optional(),
  notes: z.string().optional(),
});
export type AcmeQaResolverV1 = z.infer<typeof AcmeQaResolverV1Schema>;

// ─────────────────────────────────────────────────────────────────────────────
// Shared fact fields — the work ticket, rendered as a dictionary.
// ─────────────────────────────────────────────────────────────────────────────

/** A read-only order fact; renders as a dictionary row via the section option. */
function fact(bind: string, title: string, description: string): Record<string, unknown> {
  return {
    type: 'string',
    title,
    readOnly: true,
    default: '',
    'x-lt-bind': bind,
    'x-lt-section': 'The order',
    'x-lt-hide-if-empty': true,
    description,
  };
}

const ORDER_FACTS: Record<string, Record<string, unknown>> = {
  po: { ...fact('po', 'PO', 'The customer’s purchase order'), 'x-lt-hide-if-empty': false },
  orderId: { ...fact('orderId', 'Order', 'The order at this station'), 'x-lt-hide-if-empty': false },
  leftQuantity: fact('leftQuantity', 'Left Qty', 'Left units in the order'),
  rightQuantity: fact('rightQuantity', 'Right Qty', 'Right units in the order'),
  orthoticType: fact('orthoticType', 'Orthotic Type', 'The catalog type'),
  shoeSize: fact('shoeSize', 'Shoe Size', 'Ticket format: M10 / F8'),
  material: fact('material', 'Material', 'The printed material'),
  certified: fact('certified', 'Certified', 'Certified handling rules apply when true'),
};

// ─────────────────────────────────────────────────────────────────────────────
// The ADDONS form — custom work is the centerpiece.
// ─────────────────────────────────────────────────────────────────────────────

export const ACME_ADDONS_FORM_SCHEMA = {
  type: 'object',
  // No schema title: the escalation's own name is the page title.
  'x-lt-layout': 'two-column',
  'x-lt-section-options': {
    'The order': { display: 'dictionary', columns: 2 },
  },
  'x-lt-help': [
    '### Addons',
    '',
    'The catalog policy routed this order here: it carries extrinsic work — postings, pads, components — attached after printing, before gluing.',
    '',
    '**Custom work — this order** names exactly what it carries. The facts carry the angles and values.',
    '',
    'Done: set **Outcome → Complete**, confirm each custom item on the piece, Resolve — the order moves on to post-print QA.',
    '',
    'Problem: set **Outcome → Reject** — check the reasons, describe what you see, pick the destination, attach a photo. Resolve to send the report to the manager’s review.',
    '',
    '**The facts on this item** — the side panel’s Metadata view carries the order’s work facts. Hover any value to find every order that shares it.',
  ].join('\n'),
  'x-lt-order': [
    'po', 'orderId',
    'leftQuantity', 'rightQuantity',
    'orthoticType', 'material',
    'outcome',
    'checks',
    'customChecks',
    'rejectReasons',
    'rejectReason',
    'sendBackTo', 'rejectPhoto',
    'notes',
  ],
  required: ['outcome', 'rejectReasons', 'rejectReason'],
  properties: {
    po: ORDER_FACTS.po,
    orderId: ORDER_FACTS.orderId,
    leftQuantity: ORDER_FACTS.leftQuantity,
    rightQuantity: ORDER_FACTS.rightQuantity,
    orthoticType: ORDER_FACTS.orthoticType,
    material: ORDER_FACTS.material,
    // ── The decision — one explicit choice; the form waits on it ──
    outcome: {
      type: 'string',
      title: 'Outcome',
      enum: ['Complete', 'Reject'],
      default: '',
      'x-lt-span': 2,
      'x-lt-bind': 'outcome',
      'x-lt-section': 'The decision',
      description: 'Pick Complete to send the order to post-print QA; pick Reject to file a report',
    },
    // ── Complete: the standard ritual (arrives pre-checked) + the custom work ──
    checks: {
      type: 'object',
      title: 'Every order',
      'x-lt-widget': 'checklist',
      'x-lt-source': 'envelope.checklist_items',
      'x-lt-require-all': true,
      'x-lt-span': 2,
      'x-lt-bind': 'checks',
      'x-lt-section': 'Fixed review — every order',
      'x-lt-showIf': 'resolver.outcome=Complete',
      description: 'Uncheck anything that is not true — the standard arrives confirmed',
    },
    customChecks: {
      type: 'object',
      title: 'Custom work',
      'x-lt-widget': 'checklist',
      'x-lt-source': 'envelope.custom_items',
      'x-lt-require-all': true,
      'x-lt-span': 2,
      'x-lt-bind': 'customChecks',
      'x-lt-section': 'Custom work — this order',
      'x-lt-showIf': 'resolver.outcome=Complete',
      description: 'Confirm each item on the piece — this is what the order carries beyond the standard',
    },
    // ── Reject: the report (fades in with the choice) ──
    rejectReasons: {
      type: 'object',
      title: 'What went wrong',
      'x-lt-widget': 'checklist',
      'x-lt-source': 'envelope.reject_reason_items',
      'x-lt-variant': 'chips',
      'x-lt-span': 2,
      'x-lt-bind': 'report.reasons',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Check every reason that applies',
    },
    rejectReason: {
      type: 'string',
      format: 'textarea',
      title: 'In your own words',
      default: '',
      minLength: 10,
      maxLength: 500,
      'x-lt-span': 2,
      'x-lt-bind': 'report.reason',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Say what you see and where — the manager reads this first',
    },
    sendBackTo: {
      type: 'string',
      title: 'Send back to',
      enum: ['Printing', 'Design'],
      default: 'Printing',
      'x-lt-bind': 'report.sendBackTo',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Pick Printing to remake it, or Design to return it to the designer',
    },
    rejectPhoto: {
      type: 'string',
      title: 'Photo',
      'x-lt-widget': 'file-upload',
      accept: 'image/*',
      default: '',
      'x-lt-bind': 'report.photos[0]',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Attach a photo — it travels with the report',
    },
    // ── Sign-off — appears once the decision is made ──
    notes: {
      type: 'string',
      format: 'textarea',
      title: 'Notes',
      default: '',
      maxLength: 300,
      'x-lt-span': 2,
      'x-lt-bind': 'notes',
      'x-lt-section': 'Sign-off',
      'x-lt-showIf': 'resolver.outcome',
      description: 'Record anything worth keeping (audit trail)',
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// The POST-PRINT QA form — the fixed review ritual and the rejection report.
// ─────────────────────────────────────────────────────────────────────────────

export const ACME_QA_FORM_SCHEMA = {
  type: 'object',
  'x-lt-layout': 'two-column',
  'x-lt-section-options': {
    'The order': { display: 'dictionary', columns: 2 },
  },
  'x-lt-help': [
    '### Post-print inspection',
    '',
    'Match the prints to the facts on this item: counts, sides, material. Then work the checklist.',
    '',
    '| Look for | It looks like |',
    '|---|---|',
    '| Strings & burrs | Wisps on the surface — the most common reject |',
    '| Layer separation | A seam you can catch a fingernail on |',
    '| Warping | The piece rocks on a flat table |',
    '| Incomplete fill | Light shows through where it shouldn’t |',
    '| Wrong material | Certified orders must match the spool tag |',
    '',
    'Pass: set **Outcome → Pass**, complete the checklist, Resolve — the order moves on to gluing.',
    '',
    'Problem: set **Outcome → Reject** — reasons, description, counts (max {{envelope.maxRejectLeft}} left · {{envelope.maxRejectRight}} right — the order’s own quantities), destination, photo.',
    '',
    'Resolve to send the report to the manager’s review; the verdict moves the order.',
    '',
    '**The facts on this item** — the side panel’s Metadata view carries the order’s work facts. Hover any value to find every order that shares it.',
  ].join('\n'),
  'x-lt-order': [
    'po', 'orderId',
    'leftQuantity', 'rightQuantity',
    'orthoticType', 'shoeSize',
    'material', 'certified',
    'outcome',
    'checks',
    'rejectReasons',
    'rejectReason',
    'rejectLeftQuantity', 'rejectRightQuantity',
    'sendBackTo',
    'rejectPhoto',
    'notes',
  ],
  required: ['outcome', 'rejectReasons', 'rejectReason'],
  properties: {
    po: ORDER_FACTS.po,
    orderId: ORDER_FACTS.orderId,
    leftQuantity: ORDER_FACTS.leftQuantity,
    rightQuantity: ORDER_FACTS.rightQuantity,
    orthoticType: ORDER_FACTS.orthoticType,
    shoeSize: ORDER_FACTS.shoeSize,
    material: ORDER_FACTS.material,
    certified: ORDER_FACTS.certified,
    // ── The decision ──
    outcome: {
      type: 'string',
      title: 'Outcome',
      enum: ['Pass', 'Reject'],
      default: '',
      'x-lt-span': 2,
      'x-lt-bind': 'outcome',
      'x-lt-section': 'The decision',
      description: 'Pick Pass to send the order to gluing; pick Reject to file a report',
    },
    // ── Pass: the inspection ritual ──
    checks: {
      type: 'object',
      title: 'Fixed review',
      'x-lt-widget': 'checklist',
      'x-lt-source': 'envelope.checklist_items',
      'x-lt-require-all': true,
      'x-lt-span': 2,
      'x-lt-bind': 'checks',
      'x-lt-section': 'Fixed review — every order',
      'x-lt-showIf': 'resolver.outcome=Pass',
      description: 'Confirm each on the physical prints — not from memory',
    },
    // ── Reject: the report ──
    rejectReasons: {
      type: 'object',
      title: 'What went wrong',
      'x-lt-widget': 'checklist',
      'x-lt-source': 'envelope.reject_reason_items',
      'x-lt-variant': 'chips',
      'x-lt-span': 2,
      'x-lt-bind': 'report.reasons',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Check every reason that applies',
    },
    rejectReason: {
      type: 'string',
      format: 'textarea',
      title: 'In your own words',
      default: '',
      minLength: 10,
      maxLength: 500,
      'x-lt-span': 2,
      'x-lt-bind': 'report.reason',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Say what you see and where — the manager reads this first',
    },
    // The affected pair shares one cell (a 2×2 nested column group) so the
    // counts read as one unit beside the destination.
    rejectLeftQuantity: {
      type: 'number',
      title: 'Left affected',
      default: 0,
      minimum: 0,
      'x-lt-maximum': 'envelope.maxRejectLeft',
      'x-lt-column-group': 'affected',
      'x-lt-bind': 'report.left',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Count the left units affected',
    },
    rejectRightQuantity: {
      type: 'number',
      title: 'Right affected',
      default: 0,
      minimum: 0,
      'x-lt-maximum': 'envelope.maxRejectRight',
      'x-lt-column-group': 'affected',
      'x-lt-bind': 'report.right',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Count the right units affected',
    },
    sendBackTo: {
      type: 'string',
      title: 'Send back to',
      enum: ['Printing', 'Addons', 'Design'],
      default: 'Printing',
      'x-lt-bind': 'report.sendBackTo',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Pick Printing to remake it, or Design to return it to the designer',
    },
    rejectPhoto: {
      type: 'string',
      title: 'Photo of the defect',
      'x-lt-widget': 'file-upload',
      accept: 'image/*',
      default: '',
      'x-lt-span': 2,
      'x-lt-bind': 'report.photos[0]',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Attach a photo — it travels with the report',
    },
    // ── Sign-off — appears once the decision is made ──
    notes: {
      type: 'string',
      format: 'textarea',
      title: 'Notes',
      default: '',
      maxLength: 300,
      'x-lt-span': 2,
      'x-lt-bind': 'notes',
      'x-lt-section': 'Sign-off',
      'x-lt-showIf': 'resolver.outcome',
      description: 'Record anything worth keeping (audit trail)',
    },
  },
} as const;
