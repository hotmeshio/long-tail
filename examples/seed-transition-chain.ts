/**
 * Transition Chain roles — the three onboarding-wizard steps behind the
 * x-lt-transition reference workflow (examples/workflows/transition-chain).
 *
 *   txn-step-1  Account details  — form opts into the hand-off (x-lt-transition)
 *   txn-step-2  Preferences      — form opts into the hand-off
 *   txn-step-3  Review & confirm — terminal (no hand-off)
 *
 * Mirrors seed-related-escalations.ts: create the bare role row, then layer the
 * title, dials, and versioned form_schema via updateRoleMetadata.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';

import {
  TXN_STEP1_ROLE,
  TXN_STEP1_FORM_SCHEMA,
  TXN_STEP1_LIST_SCHEMA,
  TXN_STEP2_ROLE,
  TXN_STEP2_FORM_SCHEMA,
  TXN_STEP3_ROLE,
  TXN_STEP3_FORM_SCHEMA,
} from './workflows/transition-chain/forms';

const TRANSITION_CHAIN_ROLES = [
  {
    role: TXN_STEP1_ROLE,
    title: 'Onboarding · Account',
    description: 'Step 1 of the onboarding wizard — the account form. Whoever claims and submits becomes the owner and is handed straight to their preferences step. The list view starts an account in one click ("Start Onboarding").',
    form_schema: TXN_STEP1_FORM_SCHEMA,
    list_schema: TXN_STEP1_LIST_SCHEMA as Record<string, unknown>,
  },
  {
    role: TXN_STEP2_ROLE,
    title: 'Onboarding · Preferences',
    description: 'Step 2 of the onboarding wizard — born assigned to the owner from step 1. Submitting hands them the final review.',
    form_schema: TXN_STEP2_FORM_SCHEMA,
  },
  {
    role: TXN_STEP3_ROLE,
    title: 'Onboarding · Confirm',
    description: 'Step 3 of the onboarding wizard — the final review, born assigned to the owner. Submitting completes the chain and returns to the list.',
    form_schema: TXN_STEP3_FORM_SCHEMA,
  },
] as const;

export async function seedTransitionChainRoles(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  for (const def of TRANSITION_CHAIN_ROLES) {
    try {
      await createRole(def.role);
    } catch { /* ON CONFLICT DO NOTHING */ }

    const row = existing.get(def.role);
    const unconfigured = row == null || row.title == null;
    const listSchema = (def as { list_schema?: Record<string, unknown> }).list_schema;

    // Always push the latest schemas so code changes (the list_schema, form
    // edits) land without a manual API call; set the title and dials only on
    // first configure, so operator edits are never clobbered.
    try {
      await updateRoleMetadata(def.role, {
        ...(unconfigured
          ? {
              title: def.title,
              description: def.description,
              ops_visible: true,
              parent_role: null,
              sla_minutes: 30,
              target_per_hour: 10,
              priority_threshold_minutes: 30,
            }
          : {}),
        form_schema: def.form_schema,
        ...(listSchema ? { list_schema: listSchema } : {}),
      });
      loggerRegistry.info(`[examples] transition-chain role verified (${def.role})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to update transition-chain role ${def.role}: ${err.message}`);
    }
  }
}
