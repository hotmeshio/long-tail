/**
 * Transition Chain — the reference workflow for the x-lt-transition hand-off.
 *
 * A three-step onboarding wizard. Each step is its own role-owned escalation;
 * resolving one hands the SAME user straight to the next, so it feels like a
 * multi-page form rather than a queue:
 *
 *   txn-step-1  Account details  — open to the pool; whoever claims + submits
 *               becomes the owner. Its form opts into the hand-off via the
 *               top-level x-lt-transition tokens.
 *   txn-step-2  Preferences      — BORN ASSIGNED to the owner (parented to
 *               step 1); the dashboard lands them on it automatically. Also
 *               opts into the hand-off.
 *   txn-step-3  Review & confirm — born assigned to the owner (parented to
 *               step 2). No x-lt-transition — the last step, so submitting it
 *               simply returns to the list.
 *
 * The x-lt-transition tokens are UX only (show a wait screen + message +
 * timeout). Navigation is driven by the engine's born-assigned `claimed` event
 * (assigned_to + parent_id + assigned_at_creation) — see useFollowMyClaims.
 */

import { z } from 'zod';

export const TXN_STEP1_ROLE = 'txn-step-1';
export const TXN_STEP2_ROLE = 'txn-step-2';
export const TXN_STEP3_ROLE = 'txn-step-3';

export const TXN_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Resolver contracts
// ─────────────────────────────────────────────────────────────────────────────

export const TxnStep1ResolverV1Schema = z.object({
  full_name: z.string(),
  email: z.string(),
});
export type TxnStep1V1 = z.infer<typeof TxnStep1ResolverV1Schema>;

export const TxnStep2ResolverV1Schema = z.object({
  plan: z.enum(['Starter', 'Team', 'Enterprise']),
  seats: z.number().optional(),
});
export type TxnStep2V1 = z.infer<typeof TxnStep2ResolverV1Schema>;

export const TxnStep3ResolverV1Schema = z.object({
  confirmed: z.boolean(),
  notes: z.string().optional(),
});
export type TxnStep3V1 = z.infer<typeof TxnStep3ResolverV1Schema>;

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Account details (opts into the hand-off)
// ─────────────────────────────────────────────────────────────────────────────

export const TXN_STEP1_FORM_SCHEMA = {
  type: 'object',
  // Cancel in this process means "send home": the item returns to the queue
  // and the chain re-creates the same step. The footer and every admin cancel
  // surface (detail, bulk toolbar, confirm modal) speak this label.
  'x-lt-labels': { cancel: 'Send Home' },
  'x-lt-transition': true,
  'x-lt-transition-message': [
    '**Account saved.**',
    '',
    'Setting up your preferences — one moment…',
  ].join('\n'),
  'x-lt-transition-max-wait-seconds': 20,
  // If the follow-on never arrives (a dropped event), land here instead of
  // history.back(): the pool of accounts awaiting onboarding.
  'x-lt-transition-done': '/escalations/available?role=txn-step-1',
  'x-lt-help': [
    '### Step 1 of 3 · Account',
    '',
    'Enter the account details and submit. You will be taken straight to the',
    'next step — no need to return to a queue.',
    '',
    '**Send Home** returns the account to the pool; onboarding restarts from',
    'this step.',
  ].join('\n'),
  'x-lt-order': ['full_name', 'email'],
  required: ['full_name', 'email'],
  properties: {
    full_name: {
      type: 'string',
      title: 'Full name',
      default: '',
      minLength: 2,
      maxLength: 120,
      description: 'The account holder',
    },
    email: {
      type: 'string',
      format: 'email',
      title: 'Email',
      default: '',
      description: 'Where confirmations are sent',
    },
  },
} as const;

// Step 1 list view — the pool of accounts awaiting onboarding. The row action
// opts into the list-driven claim-and-submit: "Start Onboarding" claims the row,
// submits the account form's seeded defaults, and — because the form declares
// x-lt-transition — hands the person straight to their preferences step (step 2,
// born assigned). The demo for x-lt-row-action `submitOnClaim` (see
// docs/hitl/x-lt-list-schema.md); the behavior itself lives on the form.
export const TXN_STEP1_LIST_SCHEMA = {
  'x-lt-layout': 'facet-table',
  'x-lt-help': [
    '# Accounts awaiting onboarding',
    '',
    'Start one — it claims the account, submits it, and takes you straight to the',
    'preferences step. No queue round-trip.',
  ].join('\n'),
  'x-lt-columns': [
    { label: 'Account', value: '{{metadata.account}}', priority: 1 },
    { label: 'Step', value: '{{escalation.description}}' },
    { label: 'Waiting', value: '{{escalation.created_at}}', format: 'age' },
  ],
  'x-lt-row-action': {
    submitOnClaim: true,
    label: 'Start Onboarding',
    durationMinutes: 30,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Preferences (opts into the hand-off)
// ─────────────────────────────────────────────────────────────────────────────

export const TXN_STEP2_FORM_SCHEMA = {
  type: 'object',
  'x-lt-labels': { cancel: 'Send Home' },
  'x-lt-transition': true,
  'x-lt-transition-message': [
    '**Preferences saved.**',
    '',
    'Taking you to the final review…',
  ].join('\n'),
  'x-lt-transition-max-wait-seconds': 20,
  // If the follow-on never arrives (a dropped event), land here instead of
  // history.back(): the pool of accounts awaiting onboarding.
  'x-lt-transition-done': '/escalations/available?role=txn-step-1',
  'x-lt-help': [
    '### Step 2 of 3 · Preferences',
    '',
    'Choose a plan and seat count. Submitting hands you the final review step.',
  ].join('\n'),
  'x-lt-order': ['plan', 'seats'],
  required: ['plan'],
  properties: {
    plan: {
      type: 'string',
      title: 'Plan',
      enum: ['Starter', 'Team', 'Enterprise'],
      default: '',
      description: 'The subscription tier',
    },
    seats: {
      type: 'number',
      title: 'Seats',
      default: 1,
      minimum: 1,
      maximum: 500,
      description: 'How many seats to provision',
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Review & confirm (terminal — no hand-off)
// ─────────────────────────────────────────────────────────────────────────────

export const TXN_STEP3_FORM_SCHEMA = {
  type: 'object',
  'x-lt-labels': { cancel: 'Send Home' },
  // The last step is reached by a forward transition, so history.back() is
  // wrong. Declare where "done" goes — here, the pool of accounts awaiting
  // onboarding, so the operator flows straight into the next one. Any internal
  // path or rich faceted worklist URL works (same syntax as x-lt-href).
  'x-lt-transition-done': '/escalations/available?role=txn-step-1',
  'x-lt-help': [
    '### Step 3 of 3 · Confirm',
    '',
    'Review and confirm to finish. Submitting completes the onboarding and takes',
    'you to the queue of accounts still waiting to be onboarded.',
  ].join('\n'),
  'x-lt-order': ['confirmed', 'notes'],
  required: ['confirmed'],
  properties: {
    confirmed: {
      type: 'boolean',
      title: 'Everything looks correct',
      default: false,
      description: 'Confirm the details above are correct',
    },
    notes: {
      type: 'string',
      format: 'textarea',
      title: 'Notes',
      default: '',
      maxLength: 300,
      description: 'Anything worth keeping in the record',
    },
  },
} as const;
