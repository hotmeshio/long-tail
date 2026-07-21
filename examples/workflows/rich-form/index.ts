/**
 * Rich Form Workflow — the reference example for the role-owned, versioned
 * escalation interface.
 *
 * The escalation surface is NOT declared here. The `intake-reviewer` role owns
 * two versioned schemas (seed-rich-form.ts): a `form_schema` (the flat VIEW that
 * showcases every HITL form feature — date, email, textarea, file-upload,
 * two-column layout, ordering, required) and a `resolver_schema` (the nested
 * MODEL this workflow consumes), bound by `x-lt-bind`.
 *
 * Versioning is an AUTHOR decision, made at compile time — never a runtime
 * lookup. The workflow declares the exact interface it is written against with
 * two co-located literals: the type it expects back (`IntakeResolverV1`) and the
 * version number that produced it (`INTAKE_SCHEMA_VERSION`). Both are passed to a
 * single `conditionLT` call. `schemaVersion` folds into the escalation metadata
 * inside the same atomic Leg1 write the engine already performs — the cost of
 * this line is exactly the cost of `condition()`: one commit, no create activity,
 * no version query. When the human resolves, the pipeline validates the flat
 * submission against form_schema, maps it via x-lt-bind, validates the tree
 * against resolver_schema, and delivers it as the signal — so `conditionLT`
 * returns resolver-shaped, contract-checked `IntakeResolverV1`.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import * as activities from './activities';
import { INTAKE_ROLE, INTAKE_SCHEMA_VERSION, type IntakeResolverV1 } from './forms';

type ActivitiesType = typeof activities;

export async function richForm(envelope: LTEnvelope): Promise<any> {
  const { role = INTAKE_ROLE } = envelope.data;

  const { processIntake } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
  });

  const ctx = Durable.workflow.workflowInfo();
  const signalId = `rich-form-${ctx.workflowId}`;

  // Seed the resolve form with default values: a resolver-shaped payload the
  // dashboard reverse-maps through x-lt-bind to prefill the flat form. The user
  // sees these values on load and can change, clear, or keep them. Fields the
  // seed omits fall back to the form_schema's own defaults.
  const formDefaults: IntakeResolverV1 = {
    customer: { name: 'Acme Widgets LLC', email: 'ops@acme.example', phone: '+1-555-0100' },
    contract: { tier: 'professional', startDate: '2026-08-01', budget: 50000, approved: false },
    notes: 'Seeded defaults — edit before submitting.',
  };

  // One atomic expression: write the escalation in Leg1 AND suspend. The version
  // the workflow is coded against is a literal — the returned shape is typed to
  // match it. No create activity, no version fetch; same cost as condition().
  const response = await conditionLT<IntakeResolverV1>(signalId, {
    role,
    type: 'intake',
    subtype: 'rich-form',
    priority: 2,
    description: 'Customer Intake Form',
    workflowType: 'richForm',
    envelope: { source: 'rich-form', formDefaults },
    schemaVersion: INTAKE_SCHEMA_VERSION,
  });

  if (!response) {
    return { type: 'return' as const, data: { cancelled: true } };
  }
  const result = await processIntake(response);

  return {
    type: 'return' as const,
    data: result,
  };
}
