/**
 * Constraint-form role interface — the reference example for the full set of
 * pre-submission form guards:
 *
 *   - required with x-lt-showIf: a required field that is only enforced when
 *     visible (the form itself hides it based on a sibling field's value)
 *   - checklist widget: items are driven from envelope.checklist_items at runtime;
 *     individual items carry required?: true for per-item asterisk highlighting
 *   - minLength / maxLength — static and dynamic (x-lt-min-length / x-lt-max-length
 *     resolve a numeric value from the escalation context at submission time)
 *   - minimum / maximum — static and dynamic (x-lt-minimum / x-lt-maximum)
 *   - pattern — regexp guard with a human-readable x-lt-pattern-error label
 *
 * The escalation envelope carries `min_score`, `max_notes_length`, and
 * `checklist_items` so all dynamic constraints are exercisable from the seed
 * without code changes.
 */

export const CONSTRAINT_ROLE = 'quality-reviewer';

export const CONSTRAINT_SCHEMA_VERSION = 1;

/**
 * The payload shape the workflow receives from conditionLT after the human
 * completes the Quality Review form. All constraint guards (min, max, pattern,
 * dynamic bounds) have already been enforced by the dashboard before submit.
 */
export interface ConstraintResolverV1 {
  approved: boolean;
  rejection_reason?: string;
  reference_code: string;
  score: number;
  notes?: string;
  checks: Record<string, boolean>;
}

export const CONSTRAINT_FORM_SCHEMA = {
  title: 'Quality Review',
  description: 'Complete each section. All constraints are enforced before submission.',
  'x-lt-order': [
    'approved',
    'rejection_reason',
    'reference_code',
    'score',
    'notes',
    'checks',
  ],
  'x-lt-help': [
    '### Quality review guide',
    '',
    'Complete every visible field before submitting. Required fields are marked \\*.',
    '',
    '**Approval flow**',
    '- Set **Approved** to proceed. Leave it unchecked to reveal the Rejection Reason field.',
    '- A rejection reason is required whenever you decline.',
    '',
    '**Reference code** must be uppercase letters, digits, and dashes — e.g. `QA-2024-001`.',
    '',
    '**Score** must be at least **{{envelope.min_score}}** (the minimum set when this',
    'item was submitted). Maximum is 100.',
    '',
    '**Notes** must not exceed **{{envelope.max_notes_length}} characters**.',
    '',
    '**Checklist** — each item marked \\* must be checked before you can submit.',
  ].join('\n'),
  required: ['reference_code', 'score', 'checks'],
  properties: {
    approved: {
      type: 'boolean',
      default: false,
      description: 'Approve this submission',
    },
    rejection_reason: {
      type: 'string',
      format: 'textarea',
      default: '',
      description: 'Explain why this submission is not approved',
      // Only required (and visible) when approved is false.
      'x-lt-showIf': '!resolver.approved',
      'x-lt-section': 'Rejection',
    },
    reference_code: {
      type: 'string',
      default: '',
      description: 'Unique reference code — uppercase letters, digits, and dashes only',
      pattern: '^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$|^[A-Z0-9]$',
      'x-lt-pattern-error': 'Use uppercase letters, digits, and dashes (e.g. QA-2024-001)',
      minLength: 3,
    },
    score: {
      type: 'number',
      default: 0,
      description: 'Quality score',
      // Static upper bound of 100; lower bound is dynamic from envelope.min_score.
      maximum: 100,
      'x-lt-minimum': 'envelope.min_score',
    },
    notes: {
      type: 'string',
      format: 'textarea',
      default: '',
      description: 'Reviewer notes',
      // Dynamic upper length from envelope.max_notes_length.
      'x-lt-max-length': 'envelope.max_notes_length',
    },
    checks: {
      type: 'object',
      default: {},
      description: 'Pre-submission checklist',
      // Items are sourced from envelope.checklist_items at render time.
      'x-lt-widget': 'checklist',
      'x-lt-source': 'envelope.checklist_items',
    },
  },
};
