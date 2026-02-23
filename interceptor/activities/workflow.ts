import { randomUUID } from 'crypto';

import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../modules/config';

/**
 * Generate a deterministic workflow ID for a child workflow.
 * Called as an activity so the ID is cached across replays.
 */
export async function ltGenerateWorkflowId(prefix: string): Promise<string> {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Start a workflow via the Durable client. Used by executeLT to start
 * child workflows with a severed connection (startChild replacement).
 * Running as an activity gives full client access outside the sandbox.
 */
export async function ltStartWorkflow(input: {
  workflowName: string;
  args: any[];
  taskQueue: string;
  workflowId: string;
  expire?: number;
}): Promise<void> {
  const client = new Durable.Client({
    connection: { class: Postgres, options: postgres_options },
  });
  await client.workflow.start({
    workflowName: input.workflowName,
    args: input.args,
    taskQueue: input.taskQueue,
    workflowId: input.workflowId,
    expire: input.expire || 180,
  });
}

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
    connection: { class: Postgres, options: postgres_options },
  });
  const handle = await client.workflow.getHandle(
    input.parentTaskQueue,
    input.parentWorkflowType,
    input.parentWorkflowId,
  );
  await handle.signal(input.signalId, input.data);
}
