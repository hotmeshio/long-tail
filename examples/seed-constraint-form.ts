/**
 * Constraint-form seed — declares the `quality-reviewer` role and seeds two
 * test escalations that exercise the full set of pre-submission form guards:
 *
 *   - hidden required field (rejection_reason visible only when approved=false)
 *   - checklist widget with per-item required flags
 *   - dynamic minimum score (from envelope.min_score)
 *   - dynamic max notes length (from envelope.max_notes_length)
 *   - pattern guard on the reference code
 *
 * The first escalation has a lenient minimum score (60) so it is easy to pass.
 * The second has a strict minimum (90) to make the numeric constraint obvious.
 */

import { createRole, updateRoleMetadata, listRolesWithDetails } from '../services/role';
import { createEscalation, listEscalations } from '../services/escalation';
import { loggerRegistry } from '../lib/logger';
import { CONSTRAINT_ROLE, CONSTRAINT_FORM_SCHEMA } from './workflows/constraint-form/forms';

export async function seedConstraintFormRole(): Promise<void> {
  const existing = new Map((await listRolesWithDetails()).map((r) => [r.role, r]));

  let created = false;
  try {
    created = await createRole(CONSTRAINT_ROLE);
  } catch { /* ON CONFLICT DO NOTHING */ }

  const row = existing.get(CONSTRAINT_ROLE);
  const unconfigured = row != null && row.title == null;
  if (!created && !unconfigured) {
    loggerRegistry.info(`[examples] constraint-form role ${CONSTRAINT_ROLE} already configured, skipping`);
    return;
  }

  try {
    await updateRoleMetadata(CONSTRAINT_ROLE, {
      title: 'Quality Reviewer',
      description: 'Reviews quality submissions — the reference example for form constraint validation (min, max, regex, dynamic checklist, hidden required).',
      ops_visible: true,
      parent_role: null,
      sla_minutes: 20,
      target_per_hour: 6,
      form_schema: CONSTRAINT_FORM_SCHEMA,
    });
    loggerRegistry.info(`[examples] constraint-form role verified (${CONSTRAINT_ROLE})`);
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to update constraint-form role ${CONSTRAINT_ROLE}: ${err.message}`);
  }
}

/** Seed two test escalations unless the role already has pending items. */
export async function seedConstraintFormEscalations(): Promise<void> {
  try {
    const { escalations: existing } = await listEscalations({
      role: CONSTRAINT_ROLE,
      status: 'pending',
      limit: 1,
    });
    if (existing.length > 0) {
      loggerRegistry.info('[examples] constraint-form escalations already exist, skipping');
      return;
    }

    const sharedChecklist = [
      { id: 'documentation', label: 'All supporting documentation is attached', required: true },
      { id: 'contact_verified', label: 'Contact details have been verified', required: true },
      { id: 'photos', label: 'Before/after photos are present', required: false },
    ];

    await createEscalation({
      type: 'quality',
      subtype: 'standard-review',
      description: 'Standard quality review — score ≥ 60, notes ≤ 500 chars',
      priority: 2,
      role: CONSTRAINT_ROLE,
      envelope: JSON.stringify({
        min_score: 60,
        max_notes_length: 500,
        checklist_items: sharedChecklist,
      }),
      escalation_payload: JSON.stringify({
        submitter: 'provider-a',
        submission_id: 'sub-001',
      }),
    });

    await createEscalation({
      type: 'quality',
      subtype: 'elevated-review',
      description: 'Elevated quality review — score ≥ 90, notes ≤ 200 chars',
      priority: 1,
      role: CONSTRAINT_ROLE,
      envelope: JSON.stringify({
        min_score: 90,
        max_notes_length: 200,
        checklist_items: [
          ...sharedChecklist,
          { id: 'lab_results', label: 'Lab results match the submission', required: true },
        ],
      }),
      escalation_payload: JSON.stringify({
        submitter: 'provider-b',
        submission_id: 'sub-002',
      }),
    });

    loggerRegistry.info('[examples] constraint-form test escalations seeded (2)');
  } catch (err: any) {
    loggerRegistry.warn(`[examples] failed to seed constraint-form escalations: ${err.message}`);
  }
}
