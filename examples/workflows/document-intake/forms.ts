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
 *   - lists of each shape (docs/hitl/x-lt-lists.md): services as a closed
 *     set of chips, co-applicant emails as pills, beneficiaries as an
 *     editable table, and the statements the model found as read-only
 *     evidence that scrolls the document to its quote
 */

export const INTAKE_ROLE = 'intake-verifier';

export const INTAKE_SCHEMA_VERSION = 1;

export const ACCOUNT_TYPES = ['individual', 'joint', 'business'] as const;

export const SERVICES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'debit_card', label: 'Debit card' },
  { value: 'online_banking', label: 'Online banking' },
] as const;

export const RELATIONSHIPS = ['spouse', 'child', 'parent', 'other'] as const;

export interface Beneficiary {
  name: string;
  relationship: (typeof RELATIONSHIPS)[number];
  share: number;
}

/** A statement the model found on the application: the text, where, and what kind. */
export interface EvidenceItem {
  quote: string;
  section: string;
  page: number;
  signed?: boolean;
}

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
  services: string[] | null;
  co_applicants: string[] | null;
  beneficiaries: Beneficiary[] | null;
  evidence?: EvidenceItem[] | null;
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
    'co_applicants', 'services', 'beneficiaries',
    'street', 'city', 'postal_code',
    'evidence',
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
    co_applicants: {
      type: ['array', 'null'],
      title: 'Co-applicant emails',
      description: 'One address per co-applicant. Paste a list to add several.',
      items: { type: 'string', format: 'email', 'x-lt-transform': 'lowercase' },
      uniqueItems: true,
      maxItems: 4,
      'x-lt-unordered': true,
      'x-lt-section': 'Applicant',
    },
    services: {
      type: ['array', 'null'],
      title: 'Services requested',
      description: 'Tick every service the application asks for.',
      items: { type: 'string' },
      'x-lt-options': SERVICES.map((s) => ({ ...s })),
      'x-lt-section': 'Account',
    },
    beneficiaries: {
      type: ['array', 'null'],
      title: 'Beneficiaries',
      description: 'One row per beneficiary named on the application.',
      maxItems: 6,
      'x-lt-add-label': 'Add a beneficiary',
      'x-lt-item-key': 'name',
      'x-lt-section': 'Account',
      items: {
        type: 'object',
        required: ['name', 'share'],
        'x-lt-order': ['name', 'relationship', 'share'],
        properties: {
          name: { type: 'string', title: 'Name', 'x-lt-width': 'fill' },
          relationship: { type: 'string', title: 'Relationship', enum: [...RELATIONSHIPS], 'x-lt-width': 'sm' },
          share: { type: 'integer', title: 'Share %', minimum: 1, maximum: 100, 'x-lt-width': 'xs' },
        },
      },
    },
    evidence: {
      type: ['array', 'null'],
      title: 'Where the application says it',
      description: 'Select a statement to find it on the application.',
      readOnly: true,
      'x-lt-item-layout': 'evidence',
      'x-lt-item-title': 'quote',
      'x-lt-collapse-after': 3,
      'x-lt-locate': { file: 'file.application', page: 'page', quote: 'quote' },
      'x-lt-section': 'Sign-off',
      'x-lt-confidence': false,
    },
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
