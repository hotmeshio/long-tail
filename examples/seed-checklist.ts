/**
 * Checklist role config — declares the `checklist-operator` role with the
 * checklist widget form schema. The form renders item labels from
 * `envelope.checklist_items` at runtime; the schema itself is stable and
 * never needs to change as item count or labels vary across escalations.
 *
 * Mirrors seed-rich-form.ts: create the bare role, then layer title, dials,
 * and the versioned form_schema via updateRoleMetadata.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';
import { CHECKLIST_ROLE, CHECKLIST_FORM_SCHEMA } from './workflows/checklist-confirmation/forms';

export async function seedChecklistRole(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  let created = false;
  try {
    created = await createRole(CHECKLIST_ROLE);
  } catch { /* ON CONFLICT DO NOTHING */ }

  const row = existing.get(CHECKLIST_ROLE);
  const unconfigured = row != null && row.title == null;
  if (!created && !unconfigured) {
    loggerRegistry.info(`[examples] checklist role ${CHECKLIST_ROLE} already configured, skipping`);
    return;
  }

  try {
    await updateRoleMetadata(CHECKLIST_ROLE, {
      title: 'Checklist Operator',
      description: 'Reviews dynamic checklists — the reference example for the checklist widget and runtime-driven escalation forms.',
      ops_visible: true,
      parent_role: null,
      sla_minutes: 10,
      target_per_hour: 12,
      form_schema: CHECKLIST_FORM_SCHEMA,
    });
    loggerRegistry.info(`[examples] checklist role verified (${CHECKLIST_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to update checklist role ${CHECKLIST_ROLE}: ${err.message}`);
  }
}
