/**
 * Policy-document role config — the reference example for the role-owned,
 * versioned LIST view. A single policy is "live" at a time: a looped workflow
 * keeps exactly one escalation pending, members claim and revise it, and each
 * resolved revision becomes the audit trail. A one-item list wants to be
 * visualized as the document it is — so this role owns TWO versioned schemas:
 *
 *   form_schema — the edit form a member completes to publish the next revision
 *   list_schema — the rich list view: the live policy as a card, plus history
 *
 * The two version independently (list edits never bump the form version).
 */

/** The role that owns the policy-document surface. */
export const POLICY_ROLE = 'policy-document';

/** The form version this workflow is written against (a compile-time literal). */
export const POLICY_SCHEMA_VERSION = 1;

/** The shape the workflow gets back from conditionLT (produced by x-lt-bind). */
export interface PolicyResolverV1 {
  policy: {
    title: string;
    effectiveDate: string;
    owner: string;
    document: string;
  };
  approved: boolean;
}

/**
 * The versioned edit FORM. Flat fields map through x-lt-bind into the nested
 * PolicyResolverV1 the workflow consumes. The `document` field is a full
 * markdown editor — the policy body itself.
 */
export const POLICY_FORM_SCHEMA = {
  title: 'Revise Policy',
  description: 'Edit the policy and publish the next revision.',
  'x-lt-layout': 'two-column',
  'x-lt-help': [
    '### Revision checklist',
    '',
    '1. Confirm the **effective date** is correct.',
    '2. Keep the document in valid markdown — it renders on the list page.',
    '3. Check **approved** to publish; the workflow opens the next revision.',
  ].join('\n'),
  'x-lt-order': ['title', 'effective_date', 'owner', 'document', 'approved'],
  required: ['title', 'effective_date', 'approved'],
  properties: {
    title: {
      type: 'string',
      default: '',
      description: 'Policy title',
      'x-lt-bind': 'policy.title',
    },
    effective_date: {
      type: 'string',
      format: 'date',
      default: '',
      description: 'Effective date of this revision',
      'x-lt-bind': 'policy.effectiveDate',
    },
    owner: {
      type: 'string',
      default: '',
      description: 'Owning team',
      'x-lt-bind': 'policy.owner',
    },
    document: {
      type: 'string',
      default: '',
      'x-lt-widget': 'markdown',
      'x-lt-span': 2,
      description: 'The policy body (markdown)',
      'x-lt-bind': 'policy.document',
    },
    approved: {
      type: 'boolean',
      default: false,
      description: 'Publish this revision',
      'x-lt-bind': 'approved',
    },
  },
};

/**
 * The versioned LIST view. `active-history` renders the single live policy as a
 * card (left) and a load-on-demand revision history (right). Concise facts
 * (title, owner, revision, effective date) come from metadata; the full document
 * body comes from the escalation envelope where long text belongs.
 */
export const POLICY_LIST_SCHEMA = {
  'x-lt-layout': 'active-history',
  'x-lt-active': {
    title: '{{metadata.title}}',
    subtitle: 'Revision {{metadata.revision}} · effective {{metadata.effective_date}}',
    body: '{{envelope.formDefaults.policy.document}}',
    fields: [
      { label: 'Owner', value: '{{metadata.owner}}' },
      { label: 'Claimed by', value: '{{escalation.assigned_to}}' },
      { label: 'Opened', value: '{{escalation.created_at}}' },
    ],
  },
  'x-lt-history': {
    row: {
      title: '{{metadata.title}} — revision {{metadata.revision}}',
      subtitle: 'effective {{metadata.effective_date}} · {{metadata.owner}}',
    },
    limit: 25,
  },
};

/** The seed policy body the first revision opens with. */
export const INITIAL_POLICY_MARKDOWN = [
  '## Refund Policy',
  '',
  'Customers may request a refund within **30 days** of purchase.',
  '',
  '- Digital goods: refundable if unused.',
  '- Physical goods: refundable if returned in original condition.',
  '',
  '> Escalate disputed refunds to the finance team.',
].join('\n');
