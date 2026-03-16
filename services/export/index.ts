import type {
  ExecutionExportOptions,
  WorkflowExecution,
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
  const handle = await getHandle(taskQueue, workflowName, workflowId);
  const raw = await handle.export(options);

  return {
    workflow_id: workflowId,
    data: raw.data,
    state: raw.state,
    status: raw.status,
    timeline: raw.timeline as LTTimelineEntry[] | undefined,
    transitions: raw.transitions as LTTransitionEntry[] | undefined,
  };
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
  const handle = await getHandle(taskQueue, workflowName, workflowId);
  const status = await handle.status();
  return { workflow_id: workflowId, status };
}

/**
 * Export workflow state as a Temporal-compatible execution event history.
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
  const handle = await getHandle(taskQueue, workflowName, workflowId);
  const execution = await handle.exportExecution(options);
  await enrichEventInputs(execution);
  return postProcessExecution(execution);
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
  const handle = await getHandle(taskQueue, workflowName, workflowId);
  const state = await handle.state(true);
  return { workflow_id: workflowId, state };
}
