/**
 * Workstation — child workflow for the assembly line.
 *
 * Each workstation:
 *   1. Creates an escalation assigned to its role (grinder, gluer, etc.)
 *   2. Pauses (condition) until a human claims and resolves the escalation
 *   3. Signals the parent orchestrator with the result
 *
 * No interceptor, no registration — just raw Durable primitives
 * and a direct escalation record with signal routing metadata.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import type { StationEnvelopeData, StationResult } from './types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const { createStationEscalation, signalParent } =
  Durable.workflow.proxyActivities<ActivitiesType>({ activities });

export async function workstation(envelope: LTEnvelope): Promise<any> {
  const {
    stationName,
    role,
    instructions,
    parentSignalId,
    parentTaskQueue,
    parentWorkflowType,
    parentWorkflowId,
  } = envelope.data as StationEnvelopeData;

  const ctx = Durable.workflow.workflowInfo();
  const localSignalId = `station-done-${ctx.workflowId}`;

  // 1. Create escalation — human sees this in their queue
  await createStationEscalation({
    role,
    stationName,
    instructions,
    workflowId: ctx.workflowId,
    workflowType: 'workstation',
    taskQueue: 'long-tail-examples',
    signalId: localSignalId,
  });

  // 2. Pause until the human resolves the escalation
  const resolution = await Durable.workflow.condition<Record<string, any>>(
    localSignalId,
  ) as Record<string, any>;

  // 3. Build result and signal the parent orchestrator
  const result: StationResult = {
    stationName,
    resolution,
    completedAt: new Date().toISOString(),
  };

  await signalParent({
    parentTaskQueue,
    parentWorkflowType,
    parentWorkflowId,
    signalId: parentSignalId,
    data: result,
  });

  return { type: 'return' as const, data: result };
}
