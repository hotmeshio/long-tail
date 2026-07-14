/**
 * Policy-document role config — declares the `policy-document` role with BOTH a
 * versioned edit form (form_schema) and a versioned rich list view (list_schema).
 * The list_schema is the reference example for the role-owned list visualization:
 * the escalation list page renders it when scoped to just this role.
 *
 * Role identity (title, dials, ops config) is set once on creation and never
 * overwritten by the seeder. Schemas are always pushed so that schema changes
 * in code are applied on the next startup — updateRoleMetadata snapshots a new
 * version in lt_role_schemas each time the content changes.
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

  // Set role identity only on first creation (title, dials, etc. are user-owned
  // after that). Schemas are always updated so code changes take effect on boot.
  if (created) {
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
      loggerRegistry.info(`[examples] policy-document role created (${POLICY_ROLE})`);
      return;
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to configure policy-document role: ${err.message}`);
      return;
    }
  }

  const row = existing.get(POLICY_ROLE);
  const unconfigured = row != null && row.title == null;
  if (unconfigured) {
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
      loggerRegistry.info(`[examples] policy-document role configured (${POLICY_ROLE})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to configure policy-document role: ${err.message}`);
    }
    return;
  }

  // Role already configured — always push the latest schemas so code changes
  // are reflected without a manual API call.
  try {
    await updateRoleMetadata(POLICY_ROLE, {
      form_schema: POLICY_FORM_SCHEMA,
      list_schema: POLICY_LIST_SCHEMA,
    });
    loggerRegistry.info(`[examples] policy-document schemas refreshed (${POLICY_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to refresh policy-document schemas: ${err.message}`);
  }
}
