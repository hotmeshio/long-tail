/**
 * Step Iterator — generic durable loop over dynamic steps.
 *
 * Proves that the number and shape of steps can be entirely
 * data-driven. The orchestrator knows nothing about grinder,
 * gluer, or any specific station — it just walks the list,
 * spawns a child for each, and waits for the signal.
 *
 * Reuses the same `workstation` child workflow as the assembly line.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { JOB_EXPIRE_SECS } from '../../../modules/defaults';
import type { StationResult } from './types';

export async function stepIterator(envelope: LTEnvelope): Promise<any> {
  const { name, steps } = envelope.data as {
    name: string;
    steps: Array<{ stationName: string; role: string; instructions: string }>;
  };

  const ctx = Durable.workflow.workflowInfo();
  const results: StationResult[] = [];

  for (const [i, step] of steps.entries()) {
    const signalId = `step-${i}-${ctx.workflowId}`;
    const childWorkflowId = `workstation-${ctx.workflowId}-${i}`;

    await Durable.workflow.startChild({
      workflowName: 'workstation',
      args: [
        {
          data: {
            ...step,
            parentSignalId: signalId,
            parentTaskQueue: 'long-tail-examples',
            parentWorkflowType: 'stepIterator',
            parentWorkflowId: ctx.workflowId,
          },
          metadata: { source: 'step-iterator', step: i },
        },
      ],
      taskQueue: 'long-tail-examples',
      workflowId: childWorkflowId,
      expire: JOB_EXPIRE_SECS,
      entity: 'workstation',
    });

    const result = await Durable.workflow.condition<StationResult>(
      signalId,
    ) as StationResult;
    results.push(result);
  }

  return {
    type: 'return' as const,
    data: {
      name,
      totalSteps: steps.length,
      steps: results,
      completedAt: new Date().toISOString(),
    },
  };
}
