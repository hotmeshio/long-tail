/**
 * Rich-form role interface — the escalation FORM the `intake-reviewer` role owns.
 * This is the reference example for the role-owned, versioned JIT UI: a role owns
 * a versioned `form_schema` (the form a human fills) whose fields carry
 * `x-lt-bind` to map submitted values into the payload shape the workflow
 * consumes. Only the FORM is versioned — the payload SHAPE is the workflow's
 * contract, owned here in TypeScript (`IntakeResolverV1`).
 */

/** The role that owns the intake escalation surface. */
export const INTAKE_ROLE = 'intake-reviewer';

/**
 * The form version this workflow is written against. The author pins this literal
 * — a role's first form is version 1, and you bump it in the same commit that
 * evolves the form below (and `IntakeResolverV1` → `V2`). Passed to `conditionLT`
 * as `schemaVersion`, it folds into the row's metadata with no query or activity;
 * omit it and the resolve UI renders the role's latest form at fetch time.
 */
export const INTAKE_SCHEMA_VERSION = 1;

/**
 * The payload shape the workflow gets back from `conditionLT` — the workflow's
 * own contract, produced by the form's `x-lt-bind` map. This lives in workflow
 * code (validate with zod on the return if you want); nothing on the role
 * validates it. Version the type name alongside the form version so a drift is
 * a visible edit.
 */
export interface IntakeResolverV1 {
  customer: { name: string; email: string; phone?: string };
  contract: {
    tier: 'free' | 'starter' | 'professional' | 'enterprise';
    startDate: string;
    budget?: number;
    approved: boolean;
  };
  notes?: string;
  attachment?: string;
}

/**
 * The versioned FORM: a flat, two-column customer-intake form. Exercises every
 * HITL form feature (markdown content block, date, email, textarea,
 * file-upload, enum, required, ordering) AND carries `x-lt-bind` on the fields
 * that map into a nested payload group (a property with no bind lands at its
 * own name, 1:1).
 */
export const INTAKE_FORM_SCHEMA = {
  title: 'Customer Intake',
  description:
    'Fill out all required fields for the new customer. Verify the contact email is correct and select the appropriate service tier.',
  'x-lt-layout': 'two-column',
  'x-lt-order': ['review_guide', 'customer_name', 'contact_email', 'phone', 'tier', 'start_date', 'budget', 'approved', 'notes', 'attachment'],
  required: ['customer_name', 'contact_email', 'tier', 'start_date', 'approved'],
  properties: {
    // Markdown content block — readOnly + x-lt-widget markdown renders the
    // default's markdown source as HTML, so the versioned schema carries the
    // page itself (the review SOP), not just its inputs. The source rides
    // along in the resolver payload like any readOnly field.
    review_guide: {
      type: 'string',
      readOnly: true,
      'x-lt-widget': 'markdown',
      'x-lt-span': 2,
      default: [
        '### Review checklist',
        '',
        '1. Confirm the **legal business name** matches the signed agreement.',
        '2. Send a test message to the contact email before approving.',
        '3. Tier guidance:',
        '',
        '| Tier | When |',
        '|------|------|',
        '| `starter` | Single team, standard SLA |',
        '| `professional` | Multi-team, priority SLA |',
        '| `enterprise` | Custom contract terms |',
        '',
        '> Escalate to legal review for any non-standard contract language.',
      ].join('\n'),
    },
    customer_name: {
      type: 'string',
      default: '',
      description: 'Full legal business name',
      'x-lt-bind': 'customer.name',
    },
    contact_email: {
      type: 'string',
      format: 'email',
      default: '',
      description: 'Primary contact email address',
      'x-lt-bind': 'customer.email',
    },
    phone: {
      type: 'string',
      default: '',
      description: 'Phone number with country code',
      'x-lt-bind': 'customer.phone',
    },
    tier: {
      type: 'string',
      enum: ['free', 'starter', 'professional', 'enterprise'],
      default: 'starter',
      description: 'Service tier determines SLA and feature set',
      'x-lt-bind': 'contract.tier',
    },
    start_date: {
      type: 'string',
      format: 'date',
      default: '',
      description: 'Effective start date of the contract',
      'x-lt-bind': 'contract.startDate',
    },
    budget: {
      type: 'number',
      default: 0,
      description: 'Annual budget in USD',
      'x-lt-bind': 'contract.budget',
    },
    approved: {
      type: 'boolean',
      default: false,
      description: 'I confirm all information is accurate',
      'x-lt-bind': 'contract.approved',
    },
    // No bind — lands at the payload root as `notes` (the 1:1 default).
    notes: {
      type: 'string',
      format: 'textarea',
      default: '',
      description: 'Additional context or special requirements',
      'x-lt-span': 2,
    },
    // No bind — lands at the payload root as `attachment`.
    attachment: {
      type: 'string',
      default: '',
      'x-lt-widget': 'file-upload',
      accept: '.pdf,.doc,.docx,.png,.jpg',
      description: 'Upload signed agreement or supporting documents',
      'x-lt-span': 2,
    },
  },
};
