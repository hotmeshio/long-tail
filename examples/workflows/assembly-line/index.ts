/**
 * Assembly Line — durable orchestrator with human task queues.
 *
 * Demonstrates the core composition pattern without the LT interceptor:
 *   startChild  → spawn a child workflow (fire-and-forget)
 *   condition   → pause until the child signals back
 *   signal      → child wakes the parent when done
 *
 * A product moves through sequential workstations. Each station
 * creates an escalation for a human operator, pauses, then signals
 * the parent when the human resolves it.
 *
 * No registration, no certification, no interceptor — just Durable
 * primitives and the escalation table.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { JOB_EXPIRE_SECS } from '../../../modules/defaults';
import type { AssemblyLineStation, StationResult } from './types';

export async function assemblyLine(envelope: LTEnvelope): Promise<any> {
  const { productName, stations } = envelope.data as {
    productName: string;
    stations: AssemblyLineStation[];
  };

  const ctx = Durable.workflow.workflowInfo();
  const results: StationResult[] = [];

  for (const [i, station] of stations.entries()) {
    const signalId = `station-${i}-${ctx.workflowId}`;
    const childWorkflowId = `workstation-${ctx.workflowId}-${i}`;

    // Spawn child — fire-and-forget; only the start is awaited
    await Durable.workflow.startChild({
      workflowName: 'workstation',
      args: [
        {
          data: {
            ...station,
            parentSignalId: signalId,
            parentTaskQueue: 'long-tail-examples',
            parentWorkflowType: 'assemblyLine',
            parentWorkflowId: ctx.workflowId,
          },
          metadata: { source: 'assembly-line', station: station.stationName },
        },
      ],
      taskQueue: 'long-tail-examples',
      workflowId: childWorkflowId,
      expire: JOB_EXPIRE_SECS,
      entity: 'workstation',
    });

    // Pause until the child signals back with its result
    const result = await Durable.workflow.condition<StationResult>(signalId) as StationResult;
    results.push(result);
  }

  return {
    type: 'return' as const,
    data: {
      productName,
      stations: results,
      completedAt: new Date().toISOString(),
    },
  };
}
