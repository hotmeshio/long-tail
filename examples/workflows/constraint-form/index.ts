/**
 * Constraint Form Workflow — the reference example for pre-submission form guards.
 *
 * The `quality-reviewer` role owns a versioned form_schema that exercises every
 * validation constraint the dashboard enforces before submit:
 *
 *   - required with x-lt-showIf  — rejection_reason is required only when visible
 *   - pattern + minLength         — reference_code must be uppercase alphanumeric/dash
 *   - dynamic minimum             — score ≥ envelope.min_score (per-escalation floor)
 *   - static maximum              — score ≤ 100
 *   - dynamic maxLength           — notes ≤ envelope.max_notes_length chars
 *   - checklist widget            — checks driven from envelope.checklist_items
 *
 * Invoke via the dashboard (Workflows → constraintForm) with:
 *   {
 *     data: {
 *       min_score: 60,
 *       max_notes_length: 500,
 *       checklist_items: [{ id: "doc", label: "Documentation attached", required: true }]
 *     },
 *     metadata: { source: 'dashboard' }
 *   }
 *
 * Omit any data field to use the workflow's defaults.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import { CONSTRAINT_ROLE, CONSTRAINT_SCHEMA_VERSION, type ConstraintResolverV1 } from './forms';

type ActivitiesType = typeof activities;

interface ChecklistItem { id: string; label: string; required?: boolean }

const DEFAULT_MIN_SCORE = 60;
const DEFAULT_MAX_NOTES = 500;
const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: 'documentation', label: 'All supporting documentation is attached', required: true },
  { id: 'contact_verified', label: 'Contact details have been verified', required: true },
  { id: 'photos', label: 'Before/after photos are present', required: false },
];

export async function constraintForm(envelope: LTEnvelope): Promise<any> {
  const minScore: number = Number(envelope.data.min_score ?? DEFAULT_MIN_SCORE);
  const maxNotes: number = Number(envelope.data.max_notes_length ?? DEFAULT_MAX_NOTES);
  const checklistItems: ChecklistItem[] = Array.isArray(envelope.data.checklist_items)
    ? (envelope.data.checklist_items as ChecklistItem[])
    : DEFAULT_CHECKLIST;

  const { processQualityReview } = Durable.workflow.proxyActivities<ActivitiesType>({ activities });

  const ctx = Durable.workflow.workflowInfo();
  const signalId = `constraint-form-${ctx.workflowId}`;

  const initialChecks: Record<string, boolean> = Object.fromEntries(
    checklistItems.map((item) => [item.id, false]),
  );

  const decision = await conditionLT<ConstraintResolverV1>(signalId, {
    role: CONSTRAINT_ROLE,
    type: 'quality',
    subtype: 'constraint-form',
    priority: 2,
    description: `Quality review — score ≥ ${minScore}, notes ≤ ${maxNotes} chars`,
    workflowType: 'constraintForm',
    envelope: {
      source: 'constraint-form',
      min_score: minScore,
      max_notes_length: maxNotes,
      checklist_items: checklistItems,
      formDefaults: { checks: initialChecks },
    },
    schemaVersion: CONSTRAINT_SCHEMA_VERSION,
  });

  if (!decision) {
    return { type: 'return' as const, data: { cancelled: true } };
  }

  const result = await processQualityReview(decision);
  return { type: 'return' as const, data: result };
}
