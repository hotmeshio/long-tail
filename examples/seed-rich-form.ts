/**
 * Rich-form role config — declares the `intake-reviewer` role and its versioned
 * escalation form (with x-lt-bind). This is the reference example for the
 * role-owned, versioned JIT UI: the rich-form workflow raises an escalation to
 * this role pinning a form version, and the resolve step maps the flat form
 * submission through x-lt-bind into the payload shape the workflow consumes.
 *
 * Mirrors seed-twin.ts / seed-ortho.ts: create the bare role row, then layer the
 * title, dials, and the versioned form_schema via updateRoleMetadata (which
 * snapshots each form version and bumps current_schema_version).
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';

import { INTAKE_ROLE, INTAKE_FORM_SCHEMA } from './workflows/rich-form/forms';

export async function seedRichFormRole(): Promise<void> {
  // Only configure a freshly created or still-unconfigured row — a role the
  // admin has already edited keeps its title, dials, and schema (same guard as
  // seed-twin.ts).
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  let created = false;
  try {
    created = await createRole(INTAKE_ROLE);
  } catch { /* ON CONFLICT DO NOTHING */ }

  const row = existing.get(INTAKE_ROLE);
  const unconfigured = row != null && row.title == null;
  if (!created && !unconfigured) {
    loggerRegistry.info(`[examples] rich-form role ${INTAKE_ROLE} already configured, skipping`);
    return;
  }

  try {
    await updateRoleMetadata(INTAKE_ROLE, {
      title: 'Intake Reviewer',
      description: 'Reviews new-customer intake submissions — the rich-form escalation surface.',
      ops_visible: true,
      parent_role: null,
      sla_minutes: 15,
      target_per_hour: 8,
      priority_threshold_minutes: 15,
      form_schema: INTAKE_FORM_SCHEMA,
    });
    loggerRegistry.info(`[examples] rich-form role verified (${INTAKE_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to update rich-form role ${INTAKE_ROLE}: ${err.message}`);
  }
}
