import type {
  ExecutionExportOptions,
  WorkflowExecution,
  ActivityDetail,
} from '@hotmeshio/hotmesh/build/types/exporter';

import type {
  LTExportOptions,
  LTWorkflowExport,
  LTTimelineEntry,
  LTTransitionEntry,
} from '../../types';

import { getHandle } from './client';
import { enrichEventInputs } from './enrichment';
import { postProcessExecution } from './post-process';

/** Error thrown when a workflow job is not found (expired or never existed). */
class WorkflowNotFoundError extends Error {
  status = 404;
  constructor(workflowId: string) {
    super(`${workflowId} Not Found`);
    this.name = 'WorkflowNotFoundError';
  }
}

/**
 * Export the full workflow state for a given workflow (raw HotMesh format).
 *
 * Delegates to the HotMesh Durable `handle.export()` method and
 * normalises the result into an `LTWorkflowExport`.
 */
export async function exportWorkflow(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
  options?: LTExportOptions,
): Promise<LTWorkflowExport> {
  try {
    const handle = await getHandle(taskQueue, workflowName, workflowId);
    const raw = await handle.export({ ...options, enrich_inputs: true });

    return {
      workflow_id: workflowId,
      data: raw.data,
      state: raw.state,
      status: raw.status,
      timeline: raw.timeline as LTTimelineEntry[] | undefined,
      transitions: raw.transitions as LTTransitionEntry[] | undefined,
    };
  } catch (err: any) {
    if (err instanceof WorkflowNotFoundError) throw err;
    throw new WorkflowNotFoundError(workflowId);
  }
}

/**
 * Return only the status semaphore for a workflow.
 * 0 = complete, negative = interrupted.
 */
export async function getWorkflowStatus(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
): Promise<{ workflow_id: string; status: number }> {
  try {
    const handle = await getHandle(taskQueue, workflowName, workflowId);
    const status = await handle.status();
    return { workflow_id: workflowId, status };
  } catch {
    throw new WorkflowNotFoundError(workflowId);
  }
}

/**
 * Export workflow state as a structured execution event history.
 *
 * Delegates to HotMesh's native `handle.exportExecution()` which produces
 * typed events with ISO timestamps, durations, event cross-references,
 * system/user classification, and a summary.
 */
export async function exportWorkflowExecution(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
  options?: ExecutionExportOptions,
): Promise<WorkflowExecution> {
  try {
    const handle = await getHandle(taskQueue, workflowName, workflowId);
    const execution = await handle.exportExecution({ ...options, enrich_inputs: true });
    await enrichEventInputs(execution);
    return postProcessExecution(execution);
  } catch (err: any) {
    if (err instanceof WorkflowNotFoundError) throw err;
    throw new WorkflowNotFoundError(workflowId);
  }
}

/**
 * Return the current job state of a workflow.
 * If the workflow is complete this is also the output.
 */
export async function getWorkflowState(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
): Promise<{ workflow_id: string; state: Record<string, any> }> {
  try {
    const handle = await getHandle(taskQueue, workflowName, workflowId);
    const state = await handle.state(true);
    return { workflow_id: workflowId, state };
  } catch {
    throw new WorkflowNotFoundError(workflowId);
  }
}
