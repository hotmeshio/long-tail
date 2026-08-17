/**
 * Parameterized-form role interface — the reference example for feeding a
 * static role form with per-escalation data:
 *
 *   - x-lt-options: a select's option list resolved from the escalation
 *     envelope at render and submit time. One shared form; each row carries
 *     only its own legal values (quantity ranges, station lists) — never a
 *     copy of the schema.
 *   - x-lt-require-sum: the two quantity selects default to 0 and are guarded
 *     as a pair — their sum must reach 1, so an all-zero verdict cannot
 *     submit. Unlike x-lt-require-any, a defaulted 0 is not an answer here.
 *
 * The escalation envelope carries `left_quantity_options`,
 * `right_quantity_options`, and `return_stations`, so every select is
 * exercisable per-row from the seed without code changes.
 */

export const VERDICT_ROLE = 'verdict-reviewer';

export const VERDICT_SCHEMA_VERSION = 1;

/**
 * The payload shape the workflow receives from conditionLT after the human
 * completes the Sided Verdict form. Option membership and the min-sum guard
 * have already been enforced before submit.
 */
export interface VerdictResolverV1 {
  left_quantity: number;
  right_quantity: number;
  designation: string;
  notes?: string;
}

export const VERDICT_FORM_SCHEMA = {
  title: 'Sided Verdict',
  description: 'Record how many units on each side are affected and where the order returns to.',
  'x-lt-layout': 'two-column',
  'x-lt-order': [
    'left_quantity',
    'right_quantity',
    'designation',
    'notes',
  ],
  'x-lt-help': [
    '### Sided verdict guide',
    '',
    'Pick the affected quantity for each side. The legal range is set per order',
    'when the item is submitted — the dropdowns only offer values this order allows.',
    '',
    '**At least one side must be affected.** Both quantities start at 0; a verdict',
    'that affects neither side will not submit.',
    '',
    '**Return to** lists only the stations this order may be sent back to.',
  ].join('\n'),
  required: ['designation'],
  // The pair guard: both quantities default to 0, and their sum must reach 1.
  'x-lt-require-sum': [{ fields: ['left_quantity', 'right_quantity'] }],
  properties: {
    left_quantity: {
      type: 'number',
      title: 'Left Quantity',
      default: 0,
      description: 'Affected units on the left side',
      // Options ride the envelope: [0..N] where N is this order's left count.
      'x-lt-options': 'envelope.left_quantity_options',
    },
    right_quantity: {
      type: 'number',
      title: 'Right Quantity',
      default: 0,
      description: 'Affected units on the right side',
      'x-lt-options': 'envelope.right_quantity_options',
    },
    designation: {
      type: 'string',
      title: 'Return To',
      default: '',
      description: 'Station this order is sent back to',
      // Options ride the envelope: only this order's legal predecessors.
      'x-lt-options': 'envelope.return_stations',
      'x-lt-span': 2,
    },
    notes: {
      type: 'string',
      format: 'textarea',
      default: '',
      description: 'What was observed on the affected units',
      'x-lt-span': 2,
    },
  },
};
