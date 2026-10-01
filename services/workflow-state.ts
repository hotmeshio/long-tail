import {
  WORKFLOW_STATES,
  isTerminated,
  workflowStateFromStatus,
  type WorkflowState,
} from '../shared/workflow-state';

export { WORKFLOW_STATES, isTerminated, workflowStateFromStatus, type WorkflowState };

export interface WorkflowStateReading {
  /** HotMesh job status: above 0 running, 0 closed, below 0 terminated. */
  status: number;
  state: WorkflowState;
  terminated: boolean;
  /** The failure message, when the run closed with an error. */
  error?: string;
}

interface StatusHandle {
  status(): Promise<number>;
  state(metadata?: boolean): Promise<Record<string, any> | undefined>;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return typeof error === 'string' ? error : JSON.stringify(error);
}

/**
 * A workflow's state from its handle. A running run needs only the status.
 * A closed run can still have failed, so its outcome is read for `$error`.
 * A terminated run keeps `$error` when HotMesh still holds it; a failed read
 * of a terminated run carries no reason and is dropped.
 */
export async function readWorkflowState(handle: StatusHandle): Promise<WorkflowStateReading> {
  const status = await handle.status();
  if (status > 0) return { status, state: WORKFLOW_STATES.RUNNING, terminated: false };
  const terminated = isTerminated(status);
  let failure: unknown;
  try {
    failure = (await handle.state())?.$error;
  } catch (err) {
    if (!terminated) failure = err;
  }
  const error = failure === undefined || failure === null ? undefined : errorMessage(failure);
  if (terminated) return { status, state: WORKFLOW_STATES.FAILED, terminated, ...(error ? { error } : {}) };
  if (error) return { status, state: WORKFLOW_STATES.FAILED, terminated, error };
  return { status, state: WORKFLOW_STATES.COMPLETED, terminated };
}
