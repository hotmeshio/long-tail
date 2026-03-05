import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../modules/config';

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
