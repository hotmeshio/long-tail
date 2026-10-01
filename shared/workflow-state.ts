/**
 * A workflow's lifecycle state, read from HotMesh's job status: above 0 the
 * job is running, 0 it has closed, below 0 it was terminated (an interrupt
 * lowers the status far below 0). A terminated run is failed. A run that
 * closed at 0 can still have failed; `readWorkflowState` on the server tells
 * the two apart from the job's outcome.
 */
export const WORKFLOW_STATES = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[keyof typeof WORKFLOW_STATES];

/** The state a job status implies, before any outcome is read. */
export function workflowStateFromStatus(status: number): WorkflowState {
  if (status > 0) return WORKFLOW_STATES.RUNNING;
  if (status === 0) return WORKFLOW_STATES.COMPLETED;
  return WORKFLOW_STATES.FAILED;
}

/** Whether a job status means the run was terminated. */
export function isTerminated(status: number): boolean {
  return status < 0;
}
