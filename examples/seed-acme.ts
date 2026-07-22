/**
 * Acme station roles — declares the two roles behind the "perfect form" pair
 * (examples/workflows/acme-stations): `acme-addons` and `acme-final-qa`, each
 * owning its versioned form_schema.
 *
 * Mirrors seed-rich-form.ts: create the bare role row, then layer the title,
 * dials, and the versioned form_schema via updateRoleMetadata (which snapshots
 * each form version and bumps current_schema_version).
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { loggerRegistry } from '../lib/logger';

import {
  ACME_ADDONS_ROLE,
  ACME_ADDONS_FORM_SCHEMA,
  ACME_QA_ROLE,
  ACME_QA_FORM_SCHEMA,
} from './workflows/acme-stations/forms';

const ACME_ROLES = [
  {
    role: ACME_ADDONS_ROLE,
    title: 'Addons',
    description: 'Extrinsic work attached after fabrication — the custom-work checklist names what each widget carries.',
    form_schema: ACME_ADDONS_FORM_SCHEMA,
  },
  {
    role: ACME_QA_ROLE,
    title: 'Final QA',
    description: 'Final inspection — the fixed review ritual and the rejection report.',
    form_schema: ACME_QA_FORM_SCHEMA,
  },
] as const;

export async function seedAcmeRoles(): Promise<void> {
  // Only configure a freshly created or still-unconfigured row — a role the
  // admin has already edited keeps its title, dials, and schema.
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  for (const def of ACME_ROLES) {
    let created = false;
    try {
      created = await createRole(def.role);
    } catch { /* ON CONFLICT DO NOTHING */ }

    const row = existing.get(def.role);
    const unconfigured = row != null && row.title == null;
    if (!created && !unconfigured) {
      loggerRegistry.info(`[examples] acme role ${def.role} already configured, skipping`);
      continue;
    }

    try {
      await updateRoleMetadata(def.role, {
        title: def.title,
        description: def.description,
        ops_visible: true,
        parent_role: null,
        sla_minutes: 30,
        target_per_hour: 12,
        priority_threshold_minutes: 30,
        form_schema: def.form_schema,
      });
      loggerRegistry.info(`[examples] acme role verified (${def.role})`);
    } catch (err: any) {
      loggerRegistry.warn(`[examples] failed to update acme role ${def.role}: ${err.message}`);
    }
  }
}
