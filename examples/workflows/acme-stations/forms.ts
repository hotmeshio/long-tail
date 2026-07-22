/**
 * Acme station interfaces — the reference "perfect form" pair. Two roles own
 * versioned escalation forms for one generic two-station fabrication flow:
 *
 *   acme-addons    — extrinsic work attached after fabrication (the custom-work
 *                    checklist is the centerpiece: named per widget, clickable)
 *   acme-final-qa  — final inspection (the fixed review ritual and the
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
 *     per-widget work arrives unchecked — those are the clicks that matter.
 *   - Sign-off last. Required fields enforce themselves only while visible.
 */

import { z } from 'zod';

export const ACME_ADDONS_ROLE = 'acme-addons';
export const ACME_QA_ROLE = 'acme-final-qa';

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

/** A read-only widget fact; renders as a dictionary row via the section option. */
function fact(bind: string, title: string, description: string): Record<string, unknown> {
  return {
    type: 'string',
    title,
    readOnly: true,
    default: '',
    'x-lt-bind': bind,
    'x-lt-section': 'The widget',
    'x-lt-hide-if-empty': true,
    description,
  };
}

const WIDGET_FACTS: Record<string, Record<string, unknown>> = {
  po: { ...fact('po', 'PO', 'The customer’s purchase order'), 'x-lt-hide-if-empty': false },
  widgetId: { ...fact('widgetId', 'Widget', 'The widget at this station'), 'x-lt-hide-if-empty': false },
  leftQuantity: fact('leftQuantity', 'Left Qty', 'Left units in the run'),
  rightQuantity: fact('rightQuantity', 'Right Qty', 'Right units in the run'),
  widgetType: fact('widgetType', 'Widget Type', 'The catalog type'),
  sizeCode: fact('sizeCode', 'Size', 'The catalog size code'),
  material: fact('material', 'Material', 'The stock material'),
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
    'The widget': { display: 'dictionary', columns: 2 },
  },
  'x-lt-help': [
    '### Addons',
    '',
    'The catalog policy routed this widget here: it carries extrinsic work — fittings, mounts, components — attached after fabrication, before assembly.',
    '',
    '**Custom work — this widget** names exactly what it carries. The facts carry the specs and values.',
    '',
    'Done: set **Outcome → Complete**, confirm each custom item on the widget, Resolve — the widget moves on to final QA.',
    '',
    'Problem: set **Outcome → Reject** — check the reasons, describe what you see, pick the destination, attach a photo. Resolve to send the report to the manager’s review.',
    '',
    '**The facts on this item** — the side panel’s Metadata view carries the widget’s work facts. Hover any value to find every widget that shares it.',
  ].join('\n'),
  'x-lt-order': [
    'po', 'widgetId',
    'leftQuantity', 'rightQuantity',
    'widgetType', 'material',
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
    po: WIDGET_FACTS.po,
    widgetId: WIDGET_FACTS.widgetId,
    leftQuantity: WIDGET_FACTS.leftQuantity,
    rightQuantity: WIDGET_FACTS.rightQuantity,
    widgetType: WIDGET_FACTS.widgetType,
    material: WIDGET_FACTS.material,
    // ── The decision — one explicit choice; the form waits on it ──
    outcome: {
      type: 'string',
      title: 'Outcome',
      enum: ['Complete', 'Reject'],
      default: '',
      'x-lt-span': 2,
      'x-lt-bind': 'outcome',
      'x-lt-section': 'The decision',
      description: 'Pick Complete to send the widget to final QA; pick Reject to file a report',
    },
    // ── Complete: the standard ritual (arrives pre-checked) + the custom work ──
    checks: {
      type: 'object',
      title: 'Every widget',
      'x-lt-widget': 'checklist',
      'x-lt-source': 'envelope.checklist_items',
      'x-lt-require-all': true,
      'x-lt-span': 2,
      'x-lt-bind': 'checks',
      'x-lt-section': 'Fixed review — every widget',
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
      'x-lt-section': 'Custom work — this widget',
      'x-lt-showIf': 'resolver.outcome=Complete',
      description: 'Confirm each item on the widget — this is what it carries beyond the standard',
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
      enum: ['Fabrication', 'Design'],
      default: 'Fabrication',
      'x-lt-bind': 'report.sendBackTo',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Pick Fabrication to remake it, or Design to return it to the designer',
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
// The FINAL QA form — the fixed review ritual and the rejection report.
// ─────────────────────────────────────────────────────────────────────────────

export const ACME_QA_FORM_SCHEMA = {
  type: 'object',
  'x-lt-layout': 'two-column',
  'x-lt-section-options': {
    'The widget': { display: 'dictionary', columns: 2 },
  },
  'x-lt-help': [
    '### Final inspection',
    '',
    'Match the widgets to the facts on this item: counts, sides, material. Then work the checklist.',
    '',
    '| Look for | It looks like |',
    '|---|---|',
    '| Burrs & rough edges | Roughness at the seams — the most common reject |',
    '| Seam separation | A gap you can catch a fingernail on |',
    '| Warping | The widget rocks on a flat table |',
    '| Incomplete fill | Light shows through where it shouldn’t |',
    '| Wrong material | Certified widgets must match the stock tag |',
    '',
    'Pass: set **Outcome → Pass**, complete the checklist, Resolve — the widget moves on to assembly.',
    '',
    'Problem: set **Outcome → Reject** — reasons, description, counts (max {{envelope.maxRejectLeft}} left · {{envelope.maxRejectRight}} right — the run’s own quantities), destination, photo.',
    '',
    'Resolve to send the report to the manager’s review; the verdict moves the widget.',
    '',
    '**The facts on this item** — the side panel’s Metadata view carries the widget’s work facts. Hover any value to find every widget that shares it.',
  ].join('\n'),
  'x-lt-order': [
    'po', 'widgetId',
    'leftQuantity', 'rightQuantity',
    'widgetType', 'sizeCode',
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
    po: WIDGET_FACTS.po,
    widgetId: WIDGET_FACTS.widgetId,
    leftQuantity: WIDGET_FACTS.leftQuantity,
    rightQuantity: WIDGET_FACTS.rightQuantity,
    widgetType: WIDGET_FACTS.widgetType,
    sizeCode: WIDGET_FACTS.sizeCode,
    material: WIDGET_FACTS.material,
    certified: WIDGET_FACTS.certified,
    // ── The decision ──
    outcome: {
      type: 'string',
      title: 'Outcome',
      enum: ['Pass', 'Reject'],
      default: '',
      'x-lt-span': 2,
      'x-lt-bind': 'outcome',
      'x-lt-section': 'The decision',
      description: 'Pick Pass to send the widget to assembly; pick Reject to file a report',
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
      'x-lt-section': 'Fixed review — every widget',
      'x-lt-showIf': 'resolver.outcome=Pass',
      description: 'Confirm each on the physical widgets — not from memory',
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
      enum: ['Fabrication', 'Addons', 'Design'],
      default: 'Fabrication',
      'x-lt-bind': 'report.sendBackTo',
      'x-lt-section': 'Report the problem',
      'x-lt-showIf': 'resolver.outcome=Reject',
      description: 'Pick Fabrication to remake it, or Design to return it to the designer',
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
