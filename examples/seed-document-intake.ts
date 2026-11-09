/**
 * Document-intake seed: the `intake-verifier` role and its form. The seeded
 * run (Process 10 in seed-data.ts) stores a sample application and ID card
 * and parks one review, so the confidence tranches and the document pane
 * render on first boot.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';
import { INTAKE_ROLE, INTAKE_FORM_SCHEMA } from './workflows/document-intake/forms';

export async function seedDocumentIntakeRole(): Promise<void> {
  const existing = (await listRolesWithDetails()).find((r) => r.role === INTAKE_ROLE);
  let created = false;
  try {
    created = await createRole(INTAKE_ROLE);
  } catch { /* ON CONFLICT DO NOTHING */ }
  if (!created && existing?.title != null) return;
  try {
    await updateRoleMetadata(INTAKE_ROLE, {
      title: 'Intake Verifier',
      description: 'Verifies values a model read from an application against the application itself.',
      ops_visible: true,
      parent_role: null,
      sla_minutes: 15,
      target_per_hour: 12,
      form_schema: INTAKE_FORM_SCHEMA,
      enforce_schema: true,
    });
    loggerRegistry.info(`[examples] document-intake role verified (${INTAKE_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to update document-intake role: ${err.message}`);
  }
}
