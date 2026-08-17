/**
 * Parameterized-form seed — declares the `verdict-reviewer` role and seeds two
 * test escalations whose envelopes carry different legal values for the SAME
 * role form:
 *
 *   - per-side quantity options (x-lt-options from envelope.*_quantity_options)
 *   - legal return stations (x-lt-options from envelope.return_stations)
 *   - min-sum pair guard (x-lt-require-sum: both quantities default to 0,
 *     their sum must reach 1)
 *
 * The first escalation is a small order (left 0..3, right 0..2, two stations).
 * The second is a larger order with a different station list, so the per-row
 * difference is visible side by side in one queue.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { createEscalation, listEscalations } from '../services/escalation';
import { loggerRegistry } from '../lib/logger';
import { VERDICT_ROLE, VERDICT_FORM_SCHEMA } from './workflows/parameterized-form/forms';

export async function seedParameterizedFormRole(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  let created = false;
  try {
    created = await createRole(VERDICT_ROLE);
  } catch { /* ON CONFLICT DO NOTHING */ }

  const row = existing.get(VERDICT_ROLE);
  const unconfigured = row != null && row.title == null;
  if (!created && !unconfigured) {
    loggerRegistry.info(`[examples] parameterized-form role ${VERDICT_ROLE} already configured, skipping`);
    return;
  }

  try {
    await updateRoleMetadata(VERDICT_ROLE, {
      title: 'Verdict Reviewer',
      description: 'Records sided verdicts — the reference example for per-row form parameterization (x-lt-options from the envelope, x-lt-require-sum pair guard).',
      ops_visible: true,
      parent_role: null,
      sla_minutes: 20,
      target_per_hour: 6,
      form_schema: VERDICT_FORM_SCHEMA,
    });
    loggerRegistry.info(`[examples] parameterized-form role verified (${VERDICT_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to update parameterized-form role ${VERDICT_ROLE}: ${err.message}`);
  }
}

/** Seed two test escalations unless the role already has pending items. */
export async function seedParameterizedFormEscalations(): Promise<void> {
  try {
    const { escalations: existing } = await listEscalations({
      role: VERDICT_ROLE,
      status: 'pending',
      limit: 1,
    });
    if (existing.length > 0) {
      loggerRegistry.info('[examples] parameterized-form escalations already exist, skipping');
      return;
    }

    await createEscalation({
      type: 'verdict',
      subtype: 'sided-verdict',
      description: 'Sided verdict — small order: left 0..3, right 0..2',
      priority: 2,
      role: VERDICT_ROLE,
      envelope: JSON.stringify({
        left_quantity_options: [0, 1, 2, 3],
        right_quantity_options: [0, 1, 2],
        return_stations: ['molding', 'finishing'],
      }),
      escalation_payload: JSON.stringify({
        orderId: 'ord-001',
        serialNumber: 'SN-1001',
      }),
    });

    await createEscalation({
      type: 'verdict',
      subtype: 'sided-verdict',
      description: 'Sided verdict — large order: left 0..5, right 0..5, wider station list',
      priority: 1,
      role: VERDICT_ROLE,
      envelope: JSON.stringify({
        left_quantity_options: [0, 1, 2, 3, 4, 5],
        right_quantity_options: [0, 1, 2, 3, 4, 5],
        return_stations: ['molding', 'finishing', 'assembly', 'packaging'],
      }),
      escalation_payload: JSON.stringify({
        orderId: 'ord-002',
        serialNumber: 'SN-1002',
      }),
    });

    loggerRegistry.info('[examples] parameterized-form test escalations seeded (2)');
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed parameterized-form escalations: ${err.message}`);
  }
}
