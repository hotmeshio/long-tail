import * as EscalationService from '../../../services/escalation';
import type { StepInput } from './types';

/**
 * Legacy activity — mirrors the boilerplate ortho-pipeline createStationEscalation exactly.
 * Creates an lt_escalations record and calls enrichEscalationRouting for signal routing.
 * Two DB round-trips; no signal queue involved.
 */
export async function createEscalationLegacy(input: StepInput): Promise<string> {
  const escalation = await EscalationService.createEscalation({
    type: 'sq-station',
    subtype: input.stationName,
    description: input.instructions,
    priority: 2,
    role: input.role,
    envelope: JSON.stringify({ station: input.stationName }),
    workflow_id: input.workflowId,
    task_queue: input.taskQueue,
    workflow_type: 'sq-station-old',
  });

  await EscalationService.enrichEscalationRouting(
    escalation.id,
    {
      signal_routing: {
        engine: 'durable',
        taskQueue: input.taskQueue,
        workflowType: 'sq-station-old',
        workflowId: input.workflowId,
        signalId: input.signalId,
      },
    },
    {
      workflowType: 'sq-station-old',
      workflowId: input.workflowId,
      taskQueue: input.taskQueue,
    },
  );

  return escalation.id;
}

/**
 * Signal-queue activity — creates an lt_escalations record flagged for signal queue routing.
 * No enrichEscalationRouting call. The conditionLT(signalId, queueConfig) call in the
 * workflow atomically creates the hotmesh_signals row and suspends in one transaction.
 */
export async function createEscalationSignalQueue(input: StepInput): Promise<string> {
  const escalation = await EscalationService.createEscalation({
    type: 'sq-station',
    subtype: input.stationName,
    description: input.instructions,
    priority: 2,
    role: input.role,
    envelope: JSON.stringify({ station: input.stationName }),
    workflow_id: input.workflowId,
    task_queue: input.taskQueue,
    workflow_type: 'sq-station-new',
    metadata: {
      signal_id: input.signalId,
      signal_queue: true,
    },
  });

  return escalation.id;
}
