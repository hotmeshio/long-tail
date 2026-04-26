/**
 * Assembly Line Activities
 *
 * Side-effect functions that run outside the deterministic workflow
 * sandbox. Each is wrapped via proxyActivities so results are
 * checkpointed and replayed on restart.
 *
 * Two responsibilities:
 *   1. Create an escalation with signal routing so the resolve API
 *      can wake the paused child workflow.
 *   2. Signal the parent orchestrator when the child completes.
 */

import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../../../lib/db';
import {
  createEscalation,
  enrichEscalationRouting,
} from '../../../services/escalation';

// ── Create station escalation ──────────────────────────────────────

export async function createStationEscalation(input: {
  role: string;
  stationName: string;
  instructions: string;
  workflowId: string;
  workflowType: string;
  taskQueue: string;
  signalId: string;
}): Promise<string> {
  const escalation = await createEscalation({
    type: 'assemblyLine',
    subtype: input.stationName,
    description: input.instructions,
    priority: 2,
    role: input.role,
    envelope: JSON.stringify({ station: input.stationName }),
    workflow_id: input.workflowId,
    task_queue: input.taskQueue,
    workflow_type: input.workflowType,
  });

  await enrichEscalationRouting(
    escalation.id,
    {
      signal_routing: {
        engine: 'durable',
        taskQueue: input.taskQueue,
        workflowType: input.workflowType,
        workflowId: input.workflowId,
        signalId: input.signalId,
      },
    },
    {
      workflowType: input.workflowType,
      workflowId: input.workflowId,
      taskQueue: input.taskQueue,
    },
  );

  return escalation.id;
}

// ── Signal parent orchestrator ─────────────────────────────────────

export async function signalParent(input: {
  parentTaskQueue: string;
  parentWorkflowType: string;
  parentWorkflowId: string;
  signalId: string;
  data: any;
}): Promise<void> {
  const client = new Durable.Client({ connection: getConnection() });
  const handle = await client.workflow.getHandle(
    input.parentTaskQueue,
    input.parentWorkflowType,
    input.parentWorkflowId,
  );
  await handle.signal(input.signalId, input.data);
}
