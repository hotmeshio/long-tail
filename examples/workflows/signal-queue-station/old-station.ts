/**
 * Old-station workflow — mirrors boilerplate ortho-pipeline/station.ts exactly.
 *
 * Pattern:
 *   1. Activity: createEscalationLegacy → lt_escalations + enrichEscalationRouting (two round-trips)
 *   2. Workflow: conditionLT(signalId) — suspends until dashboard signals via Path B
 *
 * Resolution: POST /api/escalations/{id}/resolve → Path B (signal_routing.signalId)
 */

import { Durable } from '@hotmeshio/hotmesh';

import { conditionLT } from '../../../services/orchestrator/condition';
import type { LTEnvelope } from '../../../types';
import * as activities from './activities';
import type { StepInput, StepResult } from './types';

type ActivitiesType = typeof activities;

const { createEscalationLegacy } = Durable.workflow.proxyActivities<ActivitiesType>({ activities });

export async function sqStationOld(envelope: LTEnvelope): Promise<any> {
  const { stationName, role, instructions } = envelope.data as StepInput;
  const ctx = Durable.workflow.workflowInfo();
  const signalId = `sq-old-${ctx.workflowId}`;

  await createEscalationLegacy({
    role,
    stationName,
    instructions,
    workflowId: ctx.workflowId,
    taskQueue: 'sq-station-old',
    signalId,
  });

  const resolution = await conditionLT<StepResult>(signalId);

  return {
    type: 'return' as const,
    data: { stationName, resolution, completedAt: new Date().toISOString() },
  };
}
