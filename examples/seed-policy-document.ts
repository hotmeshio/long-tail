/**
 * Policy-document role config — declares the `policy-document` role with BOTH a
 * versioned edit form (form_schema) and a versioned rich list view (list_schema).
 * The list_schema is the reference example for the role-owned list visualization:
 * the escalation list page renders it when scoped to just this role.
 *
 * Mirrors seed-rich-form.ts: create the bare role, then layer the title, dials,
 * and the two schemas via updateRoleMetadata (form + list version on their own
 * independent timelines).
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';

import { POLICY_ROLE, POLICY_FORM_SCHEMA, POLICY_LIST_SCHEMA } from './workflows/policy-document/forms';

export async function seedPolicyDocumentRole(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  let created = false;
  try {
    created = await createRole(POLICY_ROLE);
  } catch { /* ON CONFLICT DO NOTHING */ }

  const row = existing.get(POLICY_ROLE);
  const unconfigured = row != null && row.title == null;
  if (!created && !unconfigured) {
    loggerRegistry.info(`[examples] policy-document role ${POLICY_ROLE} already configured, skipping`);
    return;
  }

  try {
    await updateRoleMetadata(POLICY_ROLE, {
      title: 'Policy Document',
      description: 'Maintains the live policy — one revision is authoritative at a time; the rest are history.',
      ops_visible: true,
      parent_role: null,
      sla_minutes: 60,
      target_per_hour: 1,
      form_schema: POLICY_FORM_SCHEMA,
      list_schema: POLICY_LIST_SCHEMA,
    });
    loggerRegistry.info(`[examples] policy-document role verified (${POLICY_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to update policy-document role ${POLICY_ROLE}: ${err.message}`);
  }
}
