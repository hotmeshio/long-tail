/**
 * Reverter — durable step loop with revert support.
 *
 * Like stepIterator, but each human resolution can send the
 * pipeline backwards. The resolver payload controls flow:
 *
 *   { approved: true }              → advance to next step
 *   { approved: false, revertSteps: 1 }  → go back 1 step
 *   { approved: false, revertSteps: 2 }  → go back 2 steps
 *
 * The orchestrator tracks a monotonic attempt counter so every
 * child spawn gets a unique workflow ID and signal key — even
 * when revisiting a step after a revert.
 *
 * The full history (approvals + reverts) is recorded in the result.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { JOB_EXPIRE_SECS } from '../../../modules/defaults';
import type { StationResult } from './types';

interface StepEvent {
  type: 'advance' | 'revert';
  stepIndex: number;
  stationName: string;
  attempt: number;
  resolution: Record<string, any>;
  completedAt: string;
}

export async function reverter(envelope: LTEnvelope): Promise<any> {
  const { name, steps } = envelope.data as {
    name: string;
    steps: Array<{ stationName: string; role: string; instructions: string }>;
  };

  const ctx = Durable.workflow.workflowInfo();
  const history: StepEvent[] = [];
  const finalResults: StationResult[] = [];
  let stepIndex = 0;
  let attempt = 0;

  while (stepIndex < steps.length) {
    const step = steps[stepIndex];
    const signalId = `step-${stepIndex}-a${attempt}-${ctx.workflowId}`;
    const childWorkflowId = `workstation-${ctx.workflowId}-${stepIndex}-a${attempt}`;

    await Durable.workflow.startChild({
      workflowName: 'workstation',
      args: [
        {
          data: {
            ...step,
            parentSignalId: signalId,
            parentTaskQueue: 'long-tail-examples',
            parentWorkflowType: 'reverter',
            parentWorkflowId: ctx.workflowId,
          },
          metadata: {
            source: 'reverter',
            step: stepIndex,
            attempt,
            totalSteps: steps.length,
          },
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

    const approved = result.resolution?.approved !== false;
    const revertSteps = Number(result.resolution?.revertSteps) || 0;

    history.push({
      type: approved ? 'advance' : 'revert',
      stepIndex,
      stationName: step.stationName,
      attempt,
      resolution: result.resolution,
      completedAt: result.completedAt,
    });

    attempt++;

    if (approved) {
      finalResults[stepIndex] = result;
      stepIndex++;
    } else {
      // Clamp revert target to 0
      stepIndex = Math.max(0, stepIndex - revertSteps);
    }
  }

  return {
    type: 'return' as const,
    data: {
      name,
      totalSteps: steps.length,
      totalAttempts: attempt,
      steps: finalResults,
      history,
      completedAt: new Date().toISOString(),
    },
  };
}
