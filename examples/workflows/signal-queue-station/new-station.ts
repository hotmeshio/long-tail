/**
 * New-station workflow — signal-queue variant.
 *
 * Pattern:
 *   1. Activity: createEscalationSignalQueue → lt_escalations with signal_queue:true (one round-trip)
 *   2. Workflow: conditionLT(signalId, queueConfig) — atomically suspends AND inserts hotmesh_signals row
 *
 * Resolution: POST /api/escalations/{id}/resolve → Path F (metadata.signal_queue === true)
 *   Path F calls client.signalQueue.resolve(), which delivers the low-level signal through
 *   the same HotMesh signal mechanism as Path A/B — proving delivery parity.
 *
 * DB load improvement vs old-station:
 *   - No enrichEscalationRouting UPDATE (eliminated)
 *   - Suspension + signal queue insert atomic in one transaction
 */

import { Durable } from '@hotmeshio/hotmesh';

import { conditionLT } from '../../../services/orchestrator/condition';
import type { LTEnvelope } from '../../../types';
import * as activities from './activities';
import type { StepInput, StepResult } from './types';

type ActivitiesType = typeof activities;

const { createEscalationSignalQueue } = Durable.workflow.proxyActivities<ActivitiesType>({ activities });

export async function sqStationNew(envelope: LTEnvelope): Promise<any> {
  const { stationName, role, instructions } = envelope.data as StepInput;
  const ctx = Durable.workflow.workflowInfo();
  const signalId = `sq-new-${ctx.workflowId}`;

  await createEscalationSignalQueue({
    role,
    stationName,
    instructions,
    workflowId: ctx.workflowId,
    taskQueue: 'sq-station-new',
    signalId,
  });

  const resolution = await conditionLT<StepResult>(signalId, {
    role,
    type: 'sq-station',
    subtype: stationName,
    priority: 2,
    description: instructions,
    taskQueue: 'sq-station-new',
    workflowType: 'sq-station-new',
    metadata: { stationName, workflowId: ctx.workflowId },
    envelope: { station: stationName },
  });

  return {
    type: 'return' as const,
    data: { stationName, resolution, completedAt: new Date().toISOString() },
  };
}
