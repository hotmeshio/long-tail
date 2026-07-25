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
import {
  REL_WALKER_ROLE,
  REL_WALKER_FORM_SCHEMA,
  REL_PLATE_ROLE,
  REL_PLATE_FORM_SCHEMA,
  REL_CLOSER_ROLE,
  REL_CLOSER_FORM_SCHEMA,
} from './workflows/related-escalations/forms-walk';

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
  {
    role: REL_WALKER_ROLE,
    title: 'Walk Claim',
    description: 'The walk-claim queue — resolving here starts the walk: every plate for the order assigns to the resolver in one atomic step.',
    form_schema: REL_WALKER_FORM_SCHEMA,
  },
  {
    role: REL_PLATE_ROLE,
    title: 'Plates',
    description: 'One row per plate in a walk — resolved inline from the closeout form via the Bagged ✓ action, or here through the full form.',
    form_schema: REL_PLATE_FORM_SCHEMA,
  },
  {
    role: REL_CLOSER_ROLE,
    title: 'Walk Closeout',
    description: 'The walk closeout — the form embeds the walker\'s own claimed plates (assigned: "me") with inline actions, and the submit stays locked until the last plate is bagged.',
    form_schema: REL_CLOSER_FORM_SCHEMA,
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
