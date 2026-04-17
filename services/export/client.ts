import { Durable } from '@hotmeshio/hotmesh';

import { getConnection } from '../../lib/db';

export function createClient() {
  return new Durable.Client({ connection: getConnection() });
}

export async function getHandle(
  taskQueue: string,
  workflowName: string,
  workflowId: string,
) {
  const client = createClient();
  return client.workflow.getHandle(taskQueue, workflowName, workflowId);
}
