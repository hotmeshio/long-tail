/**
 * Basic Signal Workflow
 *
 * Lightweight signal-based escalation — the workflow stays running
 * while waiting for human input. No interceptor, no certification.
 *
 *   1. Creates an escalation with `signal_id` in metadata
 *   2. Pauses via `conditionLT(signalId)` — workflow stays alive
 *   3. Dashboard resolver signals in with the form payload
 *   4. `conditionLT` resolves the escalation via durable activity
 *   5. Workflow continues with the clean resolver payload
 *
 * This demonstrates the lightweight alternative to the certified
 * interceptor pattern — same escalation UX, simpler wiring.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import * as interceptorActivities from '../../../services/interceptor/activities';
import * as activities from './activities';

type InterceptorType = typeof interceptorActivities;
type ActivitiesType = typeof activities;

const LT_ACTIVITY_QUEUE = 'lt-interceptor';

export async function basicSignal(envelope: LTEnvelope): Promise<any> {
  const { message = 'Please review and approve.', role = 'reviewer' } = envelope.data;

  const { ltCreateEscalation } = Durable.workflow.proxyActivities<InterceptorType>({
    activities: interceptorActivities,
    taskQueue: LT_ACTIVITY_QUEUE,
    retry: { maximumAttempts: 3 },
  });

  const { processApproval } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
  });

  const ctx = Durable.workflow.workflowInfo();
  const signalId = `approval-${ctx.workflowId}`;

  // Create escalation with signal_id — dashboard knows to signal, not re-run.
  //
  // The resolver_schema registered in the workflow config provides the
  // default form. To override per-instance, pass metadata.form_schema:
  //
  //   metadata: {
  //     signal_id: signalId,
  //     form_schema: {
  //       properties: {
  //         approved:    { type: 'boolean', default: false, description: 'Approve?' },
  //         notes:       { type: 'string',  default: '',    description: 'Reviewer notes' },
  //         environment: { type: 'string',  enum: ['staging', 'production'] },
  //         api_key:     { type: 'string',  format: 'password', description: 'Deploy key (ephemeral)' },
  //         confidence:  { type: 'number',  default: 0,     description: 'Confidence 0-1' },
  //       },
  //     },
  //   },
  //
  // When form_schema is present it overrides the workflow config's
  // resolver_schema for this specific escalation instance.

  await ltCreateEscalation({
    type: 'signal-approval',
    subtype: 'basic-signal',
    description: message,
    role,
    envelope: JSON.stringify(envelope),
    workflowId: ctx.workflowId,
    workflowType: 'basicSignal',
    taskQueue: ctx.taskQueue,
    metadata: {
      signal_id: signalId,
      // No form_schema here — the workflow config's resolver_schema is used.
      // Pass form_schema to override per-instance (see comment above).
    },
  });

  // Pause — conditionLT handles $escalation_id stripping and resolution
  const decision = await conditionLT<{ approved: boolean; notes: string }>(signalId);

  // Continue with the clean resolver payload
  const result = await processApproval({
    approved: decision.approved,
    notes: decision.notes || '',
    message,
  });

  return {
    type: 'return' as const,
    data: result,
  };
}
