import { getPool } from '../../lib/db';
import { escalationEventData } from '../../lib/events/escalation-wire';
import { JOB_STATE, WAIT_OUTCOME_STATUS, type LTDurableProvider } from '../../types/durable-provider';
import { publishEscalationChange } from '../escalation/crud';
import { RECONCILE_CANCEL_REASON } from './constants';
import { CANCEL_RUN_WAITS } from './sql';

const CLOSED_JOB_STATES: string[] = [JOB_STATE.COMPLETED, JOB_STATE.FAILED, JOB_STATE.CANCELLED, JOB_STATE.TERMINATED];

/**
 * Cancel the pending escalations of one run's waits when the engine reports
 * the run closed. A run reported running or unknown keeps them.
 * Returns the count cancelled.
 */
export async function cancelWaitsOfClosedRun(provider: LTDurableProvider, workflowId: string, runScope: string): Promise<number> {
  const status = await provider.describe(workflowId, runScope || undefined);
  if (!CLOSED_JOB_STATES.includes(status.state)) return 0;
  return cancelRunWaits(provider.name, workflowId, runScope);
}

/** Cancel the pending escalations of one run's waits in one statement. Returns the count cancelled. */
export async function cancelRunWaits(provider: string, workflowId: string, runScope: string): Promise<number> {
  const { rows } = await getPool().query<Record<string, any>>(CANCEL_RUN_WAITS, [provider, workflowId, runScope]);
  for (const row of rows) {
    void publishEscalationChange({
      type: 'escalation.cancelled',
      source: 'service',
      workflowId: row.workflow_id || '',
      workflowName: row.workflow_type || '',
      taskQueue: row.task_queue || '',
      escalationId: row.id,
      role: row.role || '',
      status: WAIT_OUTCOME_STATUS.CANCELLED,
      data: escalationEventData(row, { reason: RECONCILE_CANCEL_REASON }),
    });
  }
  return rows.length;
}
