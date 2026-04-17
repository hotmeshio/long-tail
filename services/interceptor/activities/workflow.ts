import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../../../lib/db';
import { JOB_EXPIRE_SECS } from '../../../modules/defaults';
import { loggerRegistry } from '../../../lib/logger';

/**
 * Signal an orchestrator workflow from within the interceptor.
 * Used after a child workflow succeeds to send the result back
 * to the awaiting orchestrator via its waitFor signal.
 */
export async function ltSignalParent(input: {
  parentTaskQueue: string;
  parentWorkflowType: string;
  parentWorkflowId: string;
  signalId: string;
  data: any;
}): Promise<void> {
  const client = new Durable.Client({
    connection: getConnection(),
  });
  const handle = await client.workflow.getHandle(
    input.parentTaskQueue,
    input.parentWorkflowType,
    input.parentWorkflowId,
  );
  await handle.signal(input.signalId, input.data);
}

/**
 * Start a workflow from within an activity context.
 * Used by the triage orchestrator to auto-resolve: directly re-run the
 * original workflow with correctedData as the resolver, bypassing the
 * "create escalation → human resolves → re-run" cycle for high-confidence
 * pass-through cases.
 */
export async function ltStartWorkflow(input: {
  workflowName: string;
  taskQueue: string;
  workflowId: string;
  args: any[];
  expire?: number;
}): Promise<void> {
  const client = new Durable.Client({
    connection: getConnection(),
  });
  await client.workflow.start({
    workflowName: input.workflowName,
    args: input.args,
    taskQueue: input.taskQueue,
    workflowId: input.workflowId,
    expire: input.expire ?? JOB_EXPIRE_SECS,
  });
  loggerRegistry.info(
    `[ltStartWorkflow] started ${input.workflowName} (${input.workflowId})`,
  );
}
