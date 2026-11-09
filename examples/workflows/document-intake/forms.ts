/**
 * Document-intake role interface, the reference example for human review
 * of model-extracted values (docs/hitl/x-lt-confidence.md) beside the
 * stored documents they came from (docs/hitl/files.md):
 *
 *   - x-lt-layout "split": the application and ID card stay in a pane
 *     beside the fields, readable before the claim
 *   - x-lt-confidence: each proposed value carries its score; fields under
 *     85% carry a tranche rule, and an edited value shows what it was;
 *     `facets` stamps the review summary onto the row when it resolves
 *   - x-lt-bind: the form is flat, the payload nests under applicant and
 *     address, and proposals and scores follow the same paths
 */

export const INTAKE_ROLE = 'intake-verifier';

export const INTAKE_SCHEMA_VERSION = 1;

export const ACCOUNT_TYPES = ['individual', 'joint', 'business'] as const;

/** The payload the workflow receives once a person verifies the application. */
export interface IntakeReviewV1 {
  applicant: {
    first_name: string;
    last_name: string;
    date_of_birth: string;
    email: string;
    phone: string;
  };
  account_type: (typeof ACCOUNT_TYPES)[number];
  address: { street: string; city: string; postal_code: string };
  id_matches: 'yes' | 'no';
  notes?: string;
}

const applicant = (key: string, title: string, description: string, extra: Record<string, unknown> = {}) => ({
  type: 'string',
  title,
  description,
  default: '',
  'x-lt-bind': `applicant.${key}`,
  'x-lt-section': 'Applicant',
  ...extra,
});

const address = (key: string, title: string, description: string) => ({
  type: 'string',
  title,
  description,
  default: '',
  'x-lt-bind': `address.${key}`,
  'x-lt-section': 'Address',
});

export const INTAKE_FORM_SCHEMA = {
  title: 'Account Application',
  description: 'Check each proposed value against the application, correct what differs, then confirm the ID.',
  'x-lt-layout': 'split',
  'x-lt-confidence': {
    tranches: [
      { below: 0.6, label: 'Low', tone: 'error' },
      { below: 0.85, label: 'Check', tone: 'warning' },
    ],
    facets: true,
  },
  'x-lt-order': [
    'application', 'id_card',
    'first_name', 'last_name', 'date_of_birth', 'email', 'phone', 'account_type',
    'street', 'city', 'postal_code',
    'id_matches', 'notes',
  ],
  'x-lt-help': [
    '### Verifying an application',
    '',
    'A model read the application and proposed every value. A colored rule marks a value it was unsure of: **Low** under 60%, **Check** under 85%.',
    '',
    '| Step | Do |',
    '|------|----|',
    '| 1 | Press **Low** in the review key to walk the least certain fields |',
    '| 2 | Correct any value that differs from the application |',
    '| 3 | Press **Edited** on a field to see the proposal, or **Restore** it |',
    '| 4 | Pick whether the ID card matches, then submit |',
    '',
    'The resolved form keeps both: each corrected field shows what it was and what it became.',
  ].join('\n'),
  required: ['first_name', 'last_name', 'date_of_birth', 'email', 'account_type', 'street', 'city', 'postal_code', 'id_matches'],
  properties: {
    application: {
      type: 'string',
      title: 'Application',
      description: 'The signed application as received.',
      'x-lt-widget': 'document',
      'x-lt-source': 'file.application',
    },
    id_card: {
      type: 'string',
      title: 'ID card',
      description: 'The ID card scan sent with the application.',
      'x-lt-widget': 'document',
      'x-lt-source': 'file.id_card',
    },
    first_name: applicant('first_name', 'First name', 'Match the application exactly.'),
    last_name: applicant('last_name', 'Last name', 'Match the application exactly.'),
    date_of_birth: applicant('date_of_birth', 'Date of birth', 'Read the date as written; the form is year-month-day.', { format: 'date' }),
    email: applicant('email', 'Email', 'Copy the address character for character.', { format: 'email' }),
    phone: applicant('phone', 'Phone', 'Include the area code when the application shows one.'),
    account_type: {
      type: 'string',
      title: 'Account type',
      description: 'Pick the box ticked on the application.',
      enum: [...ACCOUNT_TYPES],
      'x-lt-section': 'Applicant',
    },
    street: address('street', 'Street', 'Number and street name.'),
    city: address('city', 'City', 'City or town.'),
    postal_code: address('postal_code', 'Postal code', 'Five digits.'),
    id_matches: {
      type: 'string',
      title: 'ID matches',
      description: 'Pick Yes when the card shows the same name and date of birth.',
      enum: ['yes', 'no'],
      'x-lt-section': 'Sign-off',
      'x-lt-confidence': false,
    },
    notes: {
      type: 'string',
      format: 'textarea',
      title: 'Notes',
      description: 'Say what you corrected and why, in a line.',
      default: '',
      maxLength: 500,
      'x-lt-section': 'Sign-off',
      'x-lt-confidence': false,
    },
  },
};
