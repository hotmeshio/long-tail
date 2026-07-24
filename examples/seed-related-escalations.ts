/**
 * Related Escalations roles — declares the two roles behind the x-lt-embed
 * reference workflow (examples/workflows/related-escalations):
 *
 *   rel-originator — first-stage queue; the operator's triage form
 *   rel-reviewer   — manager-review queue; the reviewer form with all three
 *                    embed widgets (link, escalation, escalation-list)
 *
 * Mirrors the seed-acme.ts pattern: create the bare role row then layer the
 * title, dials, and versioned form_schema via updateRoleMetadata.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';

import {
  REL_ORIGINATOR_ROLE,
  REL_ORIGINATOR_FORM_SCHEMA,
  REL_REVIEWER_ROLE,
  REL_REVIEWER_FORM_SCHEMA,
} from './workflows/related-escalations/forms';

const RELATED_ESCALATIONS_ROLES = [
  {
    role: REL_ORIGINATOR_ROLE,
    title: 'Originator',
    description: 'First-stage review queue — the operator decides to resolve the item directly or escalate to manager review.',
    form_schema: REL_ORIGINATOR_FORM_SCHEMA,
  },
  {
    role: REL_REVIEWER_ROLE,
    title: 'Manager Review',
    description: 'Second-stage review queue — the manager approves or rejects the escalated item, with the originator context embedded inline via x-lt-embed widgets.',
    form_schema: REL_REVIEWER_FORM_SCHEMA,
  },
] as const;

export async function seedRelatedEscalationsRoles(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  for (const def of RELATED_ESCALATIONS_ROLES) {
    let created = false;
    try {
      created = await createRole(def.role);
    } catch { /* ON CONFLICT DO NOTHING */ }

    const row = existing.get(def.role);
    const unconfigured = row != null && row.title == null;
    if (!created && !unconfigured) {
      loggerRegistry.info(`[examples] related-escalations role ${def.role} already configured, skipping`);
      continue;
    }

    try {
      await updateRoleMetadata(def.role, {
        title: def.title,
        description: def.description,
        ops_visible: true,
        parent_role: null,
        sla_minutes: 30,
        target_per_hour: 10,
        priority_threshold_minutes: 30,
        form_schema: def.form_schema,
      });
      loggerRegistry.info(`[examples] related-escalations role verified (${def.role})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to update related-escalations role ${def.role}: ${err.message}`);
    }
  }
}
